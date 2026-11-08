# flightpowers (Python)

Official client for the FlightPowers APIs: live Google Flights, Booking.com, Airbnb and Google Hotels data as JSON, through your own RapidAPI key.

- Python 3.9+, standard library only (no dependencies). Type hints included.
- Docs: https://flightpowers.com/docs/sdks (SDK guide) and https://flightpowers.com/docs

## Install

```sh
pip install flightpowers
```

## Get a key

Subscribe to the listing you need on RapidAPI and copy your key. Every listing has a free BASIC plan, then plans from $10 a month on each RapidAPI listing (see https://flightpowers.com/pricing). One key works on every listing you subscribe to.

| Namespace | RapidAPI listing |
|---|---|
| `flights` | https://rapidapi.com/mtnrabi/api/google-flights-live-api |
| `booking` | https://rapidapi.com/mtnrabi/api/booking-live-api |
| `airbnb` | https://rapidapi.com/mtnrabi/api/airbnb-live-api |
| `google_hotels` | https://rapidapi.com/mtnrabi/api/google-hotels-live-api |

## Quickstart

### Google Flights

```python
import os
from flightpowers import FlightPowers
fp = FlightPowers(os.environ["RAPIDAPI_KEY"])
res = fp.flights.oneway(from_airport="JFK", to_airport="LHR", departure_date="2027-01-20")
print(res.meta.search_status)
if res.data:  # an empty search (search_status "empty") returns []
    print(res.data[0]["price"], res.data[0].get("price_range_in_relation_to_other_periods"))
```

Round trips (`fp.flights.roundtrip`) come back with both legs paired and one total per row. `oneway_multi_airport` / `roundtrip_multi_airport` take 1 to 4 airports a side in one request. They also take a party with a child or an infant (passenger codes 2, 3, 4) and round trips over 32 nights: those are searched pair by pair on Google's own search call, as on the single-airport endpoints, with `meta.search_notes` set to `via_rpc`, no price range on those rows, and up to about a minute per call. Leave `use_fallback` out for them: on the round trip, `use_fallback=False` keeps an adults' stay over 32 nights on Google's page only (on many routes a 503 `upstream_no_render`).

### Booking.com

```python
import os
from flightpowers import FlightPowers
fp = FlightPowers(os.environ["RAPIDAPI_KEY"])
res = fp.booking.search(destination="Paris", checkin_date="2027-01-20", checkout_date="2027-01-23")
for p in res.data["properties"][:3]: print(p["name"], p["price_string"], p.get("review_score"))
# Also: fp.booking.hotel_by_name, fp.booking.resolve, fp.booking.rooms
```

### Airbnb

```python
import os
from flightpowers import FlightPowers
fp = FlightPowers(os.environ["RAPIDAPI_KEY"])
res = fp.airbnb.search(destination="Lisbon", checkin_date="2027-01-20", checkout_date="2027-01-23", min_bedrooms=2)
for p in res.data["properties"][:3]: print(p.get("name"), p.get("price_total"), p.get("currency"), p.get("link"))
# Also: fp.airbnb.details(listing_id=...)
```

### Google Hotels

```python
import os
from flightpowers import FlightPowers
fp = FlightPowers(os.environ["RAPIDAPI_KEY"])
res = fp.google_hotels.rates(hotel_name="Hotel Arts Barcelona", destination="Barcelona", checkin_date="2027-01-20", checkout_date="2027-01-23")
for s in (res.data["properties"][0]["sites"] if res.data["properties"] else []): print(s.get("site"), s.get("price_total"), s.get("link"))
# Also: fp.google_hotels.search(destination=..., checkin_date=..., checkout_date=...)
```

Every method takes the API's own field names as keyword arguments; arguments left at `None` are not sent, so the API applies its defaults. Fields this version does not name yet can be passed as extra keyword arguments.

## Responses

Every method returns a `Response` with `data`, `status`, `meta` and `headers`:

- `data`: the parsed JSON body.
- `meta.search_status`: `ok`, `empty`, `partial` or `degraded`, from the `X-Search-Status` header (or the body's `search_status` on Airbnb and Google Hotels). `empty` means the search finished and there is nothing; `degraded` means the search did not finish, so an empty list says nothing about availability.
- Booking.com sends no search status, so `meta.search_status` is `None` on every Booking method. A Booking search whose page gave no properties answers HTTP 404 (`No properties found...`), which raises `FlightPowersError`; a search where every room is over `budget_per_night` comes back as an empty list.
- `meta.search_reason`, `meta.search_results`, `meta.search_notes`, `meta.search_fallback`: the other `X-Search-*` headers.
- `meta.quota`: the RapidAPI `x-ratelimit-*` / `x-plan-*` headers, when present.

## Errors and retries

Any non-2xx answer raises `FlightPowersError` with `status`, `search_status`, `search_reason`, `retry` (the API's own flag from the body) and `body`. A request that got no answer has `status` 0.

```python
from flightpowers import FlightPowersError
try:
    fp.flights.oneway(from_airport="JFK", to_airport="LHR", departure_date="2027-01-20", strict=True)
except FlightPowersError as err:
    print(err.status, err.search_status, err.search_reason, err.retry)
```

Retries are off by default. `FlightPowers(key, max_retries=2)` repeats a request only when it answered HTTP 503 with `"retry": true` in its body, waiting `Retry-After` when sent, else 1 s, then 2 s (each wait capped at 60 s, at most 10 retries). Nothing else is retried: a 429 would spend more quota, and a 4xx needs a fixed request.

Options: `timeout` (socket timeout in seconds, default 180: it bounds the connect and each read, not the whole request), `retry_delay` (seconds, default 1), `base_urls` (tests and proxies), `transport` (replace the HTTP layer).

## Usage attribution

Each request body carries two extra fields, `_fp_source: "sdk-py"` and `_fp_tool: "<namespace>.<method>"`, so we can count how the SDK is used. The API removes them before it reads your request; they never change a search.

## Docs

- SDK guide: https://flightpowers.com/docs/sdks
- Flights: https://flightpowers.com/flights-api and https://flightpowers.com/flights-api/multi-airport
- Booking.com: https://flightpowers.com/hotels-api and https://flightpowers.com/hotels-api/by-name
- Airbnb: https://flightpowers.com/hotels-api/airbnb
- Google Hotels: https://flightpowers.com/hotels-api/google-hotels
- Full reference: https://flightpowers.com/llms-full.txt

## License

MIT
