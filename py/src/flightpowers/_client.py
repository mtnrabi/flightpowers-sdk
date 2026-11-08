"""The FlightPowers client (standard library only: urllib + json)."""

from __future__ import annotations

import json
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, Generic, List, Mapping, Optional, Sequence, TypeVar, Union

from ._errors import FlightPowersError

__all__ = [
    "BOOKING_FILTERS",
    "VERSION",
    "SOURCE_TAG",
    "HOSTS",
    "FlightPowers",
    "Response",
    "ResponseMeta",
]

VERSION = "0.1.2"

#: Value of ``_fp_source`` on every request this package sends.
SOURCE_TAG = "sdk-py"

#: The RapidAPI host of each listing. One key works on every listing you subscribe to.
HOSTS: Mapping[str, str] = {
    "flights": "google-flights-live-api.p.rapidapi.com",
    "booking": "booking-live-api.p.rapidapi.com",
    "airbnb": "airbnb-live-api.p.rapidapi.com",
    "google_hotels": "google-hotels-live-api.p.rapidapi.com",
}

#: The 24 Booking.com search filters ``booking.search(filters=...)`` accepts
#: (docs: https://flightpowers.com/llms-full.txt, ``/v1/hotels/search``).
BOOKING_FILTERS = (
    "free_cancellation", "breakfast_included", "breakfast_and_lunch", "breakfast_and_dinner",
    "all_meals_included", "all_inclusive", "free_wifi", "swimming_pool", "gym", "parking",
    "front_desk_24h", "review_score_7", "review_score_8", "review_score_9", "private_bathroom",
    "air_conditioning", "stars_3", "stars_4", "stars_5", "pets_allowed", "adults_only",
    "sauna", "very_good_breakfast", "accepts_online_payment",
)

#: Most retries one call may make, whatever ``max_retries`` says.
MAX_RETRIES_CAP = 10
#: Longest wait before a retry, computed or from ``Retry-After``, in seconds.
MAX_RETRY_WAIT = 60.0

T = TypeVar("T")
AirportList = Union[str, Sequence[str]]


@dataclass(frozen=True)
class ResponseMeta:
    """Search metadata from the response headers (or a body envelope)."""

    #: ``X-Search-Status`` (ok | empty | partial | degraded), or the body's ``search_status``.
    search_status: Optional[str] = None
    #: ``X-Search-Reason``, or the body's ``search_reason``.
    search_reason: Optional[str] = None
    #: ``X-Search-Results`` as an int.
    search_results: Optional[int] = None
    #: ``X-Search-Notes`` (e.g. ``via_rpc``).
    search_notes: Optional[str] = None
    #: ``X-Search-Fallback`` (e.g. ``used``).
    search_fallback: Optional[str] = None
    #: RapidAPI quota headers (``x-ratelimit-*``, ``x-plan-*``), names lower-cased.
    quota: Dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True)
class Response(Generic[T]):
    """What every SDK method returns."""

    #: The parsed JSON body.
    data: T
    #: HTTP status code.
    status: int
    meta: ResponseMeta
    #: All response headers, names lower-cased.
    headers: Dict[str, str]


Transport = Callable[[str, bytes, Dict[str, str], float], "tuple[int, Dict[str, str], bytes]"]


def _urllib_transport(url: str, body: bytes, headers: Dict[str, str], timeout: float):
    """POST with urllib. Returns (status, headers, body) for every HTTP answer, 4xx/5xx included."""
    request = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:  # noqa: S310 (https host)
            return response.status, dict(response.headers.items()), response.read()
    except urllib.error.HTTPError as error:
        payload = error.read() if error.fp is not None else b""
        return error.code, dict(error.headers.items()) if error.headers else {}, payload


def _read_meta(headers: Mapping[str, str], body: Any) -> ResponseMeta:
    def get(name: str) -> Optional[str]:
        value = headers.get(name)
        return value if value else None

    envelope = body if isinstance(body, dict) else {}

    def from_body(key: str) -> Optional[str]:
        value = envelope.get(key)
        return value if isinstance(value, str) else None

    results_raw = get("x-search-results")
    try:
        results = int(results_raw) if results_raw is not None else None
    except ValueError:
        results = None
    quota = {k: v for k, v in headers.items() if k.startswith("x-ratelimit-") or k.startswith("x-plan-")}
    return ResponseMeta(
        search_status=get("x-search-status") or from_body("search_status"),
        search_reason=get("x-search-reason") or from_body("search_reason"),
        search_results=results,
        search_notes=get("x-search-notes"),
        search_fallback=get("x-search-fallback"),
        quota=quota,
    )


def _error_message(tool: str, status: int, body: Any) -> str:
    detail = ""
    if isinstance(body, dict):
        candidate = next((body[k] for k in ("detail", "message", "error") if k in body), None)
        if isinstance(candidate, str):
            detail = candidate
        elif candidate is not None:
            detail = json.dumps(candidate)
    elif isinstance(body, str):
        detail = body[:300]
    return "FlightPowers {} answered HTTP {}{}".format(tool, status, ": " + detail if detail else "")


def _clamp_retries(value: Any) -> int:
    if isinstance(value, float) and value != value:  # NaN
        return 0
    if isinstance(value, float) and value in (float("inf"), float("-inf")):
        return MAX_RETRIES_CAP if value > 0 else 0
    return min(MAX_RETRIES_CAP, max(0, int(value)))


def _retry_after_seconds(headers: Mapping[str, str]) -> Optional[float]:
    raw = headers.get("retry-after")
    if raw is None:
        return None
    try:
        seconds = float(raw)
    except ValueError:
        return None
    return min(max(seconds, 0.0), MAX_RETRY_WAIT)


def _compact(params: Mapping[str, Any]) -> Dict[str, Any]:
    """Drop arguments left at None, so the API applies its own defaults."""
    return {k: v for k, v in params.items() if v is not None}


class FlightPowers:
    """The FlightPowers client.

    >>> fp = FlightPowers(rapidapi_key="...")
    >>> res = fp.flights.oneway(from_airport="JFK", to_airport="LHR", departure_date="2027-01-20")
    >>> res.meta.search_status, res.data[0]["price"]
    """

    def __init__(
        self,
        rapidapi_key: str,
        *,
        max_retries: int = 0,
        retry_delay: float = 1.0,
        timeout: float = 180.0,
        base_urls: Optional[Mapping[str, str]] = None,
        transport: Optional[Transport] = None,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        """
        :param rapidapi_key: your RapidAPI key (https://rapidapi.com/developer/apps).
        :param max_retries: how many times to repeat a request that answered HTTP 503
            with ``"retry": true`` in its body. Default 0 (never), capped at 10. Nothing else is retried.
        :param retry_delay: base wait in seconds before a retry, doubled each time and capped
            at 60 s; a ``Retry-After`` header wins (also capped at 60 s).
        :param timeout: socket timeout in seconds (default 180, RapidAPI's own limit). It bounds
            the connect and each read, not the whole request: a body that keeps trickling in
            can take longer in total.
        :param base_urls: override a listing's base URL (tests, proxies), keyed like ``HOSTS``.
        :param transport: replace the HTTP layer (tests).
        """
        if not isinstance(rapidapi_key, str) or not rapidapi_key.strip():
            raise ValueError("FlightPowers: rapidapi_key is required")
        self._key = rapidapi_key.strip()
        self._max_retries = _clamp_retries(max_retries)
        self._retry_delay = max(0.0, float(retry_delay))
        self._timeout = float(timeout)
        self._base_urls = {name: "https://" + host for name, host in HOSTS.items()}
        for name, url in (base_urls or {}).items():
            if name not in HOSTS:
                raise ValueError("FlightPowers: unknown product {!r} in base_urls".format(name))
            self._base_urls[name] = url.rstrip("/")
        self._transport = transport or _urllib_transport
        self._sleep = sleep
        self.flights = Flights(self)
        self.booking = Booking(self)
        self.airbnb = Airbnb(self)
        self.google_hotels = GoogleHotels(self)

    def request(
        self,
        product: str,
        path: str,
        params: Mapping[str, Any],
        tool: str,
        *,
        max_retries: Optional[int] = None,
        timeout: Optional[float] = None,
    ) -> Response[Any]:
        """Send one POST. Exposed for endpoints this version does not wrap yet."""
        if product not in HOSTS:
            raise ValueError("FlightPowers: unknown product {!r}".format(product))
        url = self._base_urls[product] + path
        payload = dict(params)
        payload["_fp_source"] = SOURCE_TAG
        payload["_fp_tool"] = tool
        body = json.dumps(payload).encode("utf-8")
        headers = {
            "content-type": "application/json",
            "accept": "application/json",
            "user-agent": "flightpowers-python/" + VERSION,
            "x-rapidapi-key": self._key,
            "x-rapidapi-host": HOSTS[product],
        }
        retries = self._max_retries if max_retries is None else _clamp_retries(max_retries)
        wait_budget = self._timeout if timeout is None else float(timeout)

        attempt = 0
        while True:
            try:
                status, raw_headers, raw_body = self._transport(url, body, headers, wait_budget)
            except Exception as cause:  # network error, timeout
                raise FlightPowersError(
                    "FlightPowers {}: request failed ({})".format(tool, cause), status=0
                ) from cause

            lower = {k.lower(): v for k, v in raw_headers.items()}
            text = raw_body.decode("utf-8", errors="replace") if raw_body else ""
            parsed: Any
            if text == "":
                parsed = None
            else:
                try:
                    parsed = json.loads(text)
                except ValueError:
                    parsed = text
            meta = _read_meta(lower, parsed)

            if 200 <= status < 300:
                return Response(data=parsed, status=status, meta=meta, headers=lower)

            error = FlightPowersError(
                _error_message(tool, status, parsed), status=status, body=parsed, meta=meta, headers=lower
            )
            if status == 503 and error.retry is True and attempt < retries:
                delay = _retry_after_seconds(lower)
                if delay is None:
                    delay = min(MAX_RETRY_WAIT, self._retry_delay * (2**attempt))
                self._sleep(delay)
                attempt += 1
                continue
            raise error


class _Namespace:
    _product = ""

    def __init__(self, client: FlightPowers) -> None:
        self._client = client

    def _post(self, path: str, tool: str, params: Mapping[str, Any], extra: Mapping[str, Any]) -> Response[Any]:
        merged = dict(params)
        merged.update(extra)
        return self._client.request(self._product, path, _compact(merged), tool)


class Flights(_Namespace):
    """Google Flights Live API (https://rapidapi.com/mtnrabi/api/google-flights-live-api)."""

    _product = "flights"

    def oneway(
        self,
        *,
        from_airport: str,
        to_airport: str,
        departure_date: str,
        max_stops: Optional[int] = None,
        airline_codes: Optional[List[str]] = None,
        exclude_airline_codes: Optional[List[str]] = None,
        departure_time_min: Optional[int] = None,
        departure_time_max: Optional[int] = None,
        departure_arrival_time_min: Optional[int] = None,
        departure_arrival_time_max: Optional[int] = None,
        sort_type: Optional[str] = None,
        currency: Optional[str] = None,
        max_price: Optional[int] = None,
        seat_type: Optional[int] = None,
        passengers: Optional[List[int]] = None,
        limit: Optional[int] = None,
        use_fallback: Optional[bool] = None,
        strict: Optional[bool] = None,
        use_ext_proxy: Optional[bool] = None,
        **extra: Any,
    ) -> Response[List[Dict[str, Any]]]:
        """One-way itineraries for a route and date (``YYYY-MM-DD``)."""
        params = dict(locals())
        return self._post("/api/google_flights/oneway/v1", "flights.oneway", _args(params), extra)

    def roundtrip(
        self,
        *,
        from_airport: str,
        to_airport: str,
        departure_date: str,
        return_date: str,
        max_departure_stops: Optional[int] = None,
        max_return_stops: Optional[int] = None,
        departure_airline_codes: Optional[List[str]] = None,
        return_airline_codes: Optional[List[str]] = None,
        departure_exclude_airline_codes: Optional[List[str]] = None,
        return_exclude_airline_codes: Optional[List[str]] = None,
        departure_departure_time_min: Optional[int] = None,
        departure_departure_time_max: Optional[int] = None,
        departure_arrival_time_min: Optional[int] = None,
        departure_arrival_time_max: Optional[int] = None,
        return_departure_time_min: Optional[int] = None,
        return_departure_time_max: Optional[int] = None,
        return_arrival_time_min: Optional[int] = None,
        return_arrival_time_max: Optional[int] = None,
        sort_type: Optional[str] = None,
        currency: Optional[str] = None,
        max_price: Optional[int] = None,
        seat_type: Optional[int] = None,
        passengers: Optional[List[int]] = None,
        limit: Optional[int] = None,
        returns_per_outbound: Optional[int] = None,
        use_fallback: Optional[bool] = None,
        strict: Optional[bool] = None,
        use_ext_proxy: Optional[bool] = None,
        **extra: Any,
    ) -> Response[List[Dict[str, Any]]]:
        """Round trips: both legs paired and priced together, one total per row."""
        params = dict(locals())
        return self._post("/api/google_flights/roundtrip/v1", "flights.roundtrip", _args(params), extra)

    def oneway_multi_airport(
        self, *, from_airport: AirportList, to_airport: AirportList, departure_date: str, **params: Any
    ) -> Response[List[Dict[str, Any]]]:
        """One-way with 1 to 4 airports a side (at most 8 pairs), one billed request.

        Other fields are the same as :meth:`oneway`; ``use_fallback`` must be False or absent.
        """
        base = {"from_airport": _airports(from_airport), "to_airport": _airports(to_airport), "departure_date": departure_date}
        return self._post("/api/google_flights/oneway_multi_airport/v1", "flights.oneway_multi_airport", base, params)

    def roundtrip_multi_airport(
        self,
        *,
        from_airport: AirportList,
        to_airport: AirportList,
        departure_date: str,
        return_date: str,
        **params: Any,
    ) -> Response[List[Dict[str, Any]]]:
        """Round trip with 1 to 4 airports a side (at most 8 pairs), one billed request."""
        base = {
            "from_airport": _airports(from_airport),
            "to_airport": _airports(to_airport),
            "departure_date": departure_date,
            "return_date": return_date,
        }
        return self._post("/api/google_flights/roundtrip_multi_airport/v1", "flights.roundtrip_multi_airport", base, params)


class Booking(_Namespace):
    """Booking Live API (https://rapidapi.com/mtnrabi/api/booking-live-api)."""

    _product = "booking"

    def search(
        self,
        *,
        destination: str,
        checkin_date: str,
        checkout_date: str,
        adults: Optional[int] = None,
        children: Optional[int] = None,
        currency: Optional[str] = None,
        proxy_country: Optional[str] = None,
        budget_per_night: Optional[float] = None,
        filters: Optional[List[str]] = None,
        sort: Optional[str] = None,
        **extra: Any,
    ) -> Response[Dict[str, Any]]:
        """Hotels at a destination (the field is ``destination``, not ``location``).

        ``filters`` takes names from ``BOOKING_FILTERS``.
        """
        params = dict(locals())
        return self._post("/search", "booking.search", _args(params), extra)

    def hotel_by_name(
        self,
        *,
        hotel_name: str,
        checkin_date: str,
        checkout_date: str,
        area: Optional[str] = None,
        adults: Optional[int] = None,
        children: Optional[int] = None,
        currency: Optional[str] = None,
        proxy_country: Optional[str] = None,
        free_cancellation: Optional[bool] = None,
        **extra: Any,
    ) -> Response[Dict[str, Any]]:
        """One hotel by name: availability and price for the stay."""
        params = dict(locals())
        return self._post("/hotel_by_name", "booking.hotel_by_name", _args(params), extra)

    def resolve(self, *, hotel_name: str, proxy_country: Optional[str] = None, **extra: Any) -> Response[Dict[str, Any]]:
        """Turn a hotel name into the ``hotel_booking_id`` that :meth:`rooms` takes."""
        params = dict(locals())
        return self._post("/resolve", "booking.resolve", _args(params), extra)

    def rooms(
        self,
        *,
        hotel_booking_id: str,
        checkin_date: str,
        checkout_date: str,
        adults: Optional[int] = None,
        children: Optional[int] = None,
        currency: Optional[str] = None,
        proxy_country: Optional[str] = None,
        free_cancellation: Optional[bool] = None,
        **extra: Any,
    ) -> Response[Dict[str, Any]]:
        """Every bookable room type for one hotel, with prices and board."""
        params = dict(locals())
        return self._post("/hotel", "booking.rooms", _args(params), extra)


class Airbnb(_Namespace):
    """Airbnb Live API (https://rapidapi.com/mtnrabi/api/airbnb-live-api)."""

    _product = "airbnb"

    def search(
        self,
        *,
        destination: str,
        checkin_date: str,
        checkout_date: str,
        adults: Optional[int] = None,
        children: Optional[int] = None,
        infants: Optional[int] = None,
        pets: Optional[int] = None,
        currency: Optional[str] = None,
        price_min: Optional[float] = None,
        price_max: Optional[float] = None,
        min_bedrooms: Optional[int] = None,
        min_beds: Optional[int] = None,
        min_bathrooms: Optional[float] = None,
        room_types: Optional[List[str]] = None,
        min_rating: Optional[float] = None,
        sort: Optional[str] = None,
        proxy_country: Optional[str] = None,
        **extra: Any,
    ) -> Response[Dict[str, Any]]:
        """Listings at a destination, with Airbnb's own filters."""
        params = dict(locals())
        return self._post("/search", "airbnb.search", _args(params), extra)

    def details(
        self,
        *,
        listing_id: str,
        checkin_date: Optional[str] = None,
        checkout_date: Optional[str] = None,
        adults: Optional[int] = None,
        currency: Optional[str] = None,
        proxy_country: Optional[str] = None,
        **extra: Any,
    ) -> Response[Dict[str, Any]]:
        """One listing by its id (a search row's ``provider_property_id``)."""
        params = dict(locals())
        return self._post("/details", "airbnb.details", _args(params), extra)


class GoogleHotels(_Namespace):
    """Google Hotels Live API (https://rapidapi.com/mtnrabi/api/google-hotels-live-api)."""

    _product = "google_hotels"

    def search(
        self,
        *,
        destination: str,
        checkin_date: str,
        checkout_date: str,
        adults: Optional[int] = None,
        children_ages: Optional[List[int]] = None,
        currency: Optional[str] = None,
        **extra: Any,
    ) -> Response[Dict[str, Any]]:
        """One page of hotels at a destination."""
        params = dict(locals())
        return self._post("/search", "google_hotels.search", _args(params), extra)

    def rates(
        self,
        *,
        checkin_date: str,
        checkout_date: str,
        hotel_name: Optional[str] = None,
        destination: Optional[str] = None,
        entity_id: Optional[str] = None,
        adults: Optional[int] = None,
        children_ages: Optional[List[int]] = None,
        currency: Optional[str] = None,
        **extra: Any,
    ) -> Response[Dict[str, Any]]:
        """One hotel's rate on each site Google lists for it (by ``hotel_name`` or ``entity_id``)."""
        if not hotel_name and not entity_id:
            raise ValueError("google_hotels.rates: pass hotel_name or entity_id")
        params = dict(locals())
        return self._post("/rates", "google_hotels.rates", _args(params), extra)


def _args(captured: Dict[str, Any]) -> Dict[str, Any]:
    """The method's named arguments, minus ``self`` and ``extra``."""
    return {k: v for k, v in captured.items() if k not in ("self", "extra", "params")}


def _airports(value: AirportList) -> Union[str, List[str]]:
    return value if isinstance(value, str) else list(value)
