import json
import re
import unittest

from flightpowers import BOOKING_FILTERS, HOSTS, SOURCE_TAG, VERSION, FlightPowers, FlightPowersError


class FakeTransport:
    """Records calls and answers from a queue (the last answer repeats)."""

    def __init__(self, *answers):
        self.answers = list(answers) or [{}]
        self.calls = []

    def __call__(self, url, body, headers, timeout):
        self.calls.append({"url": url, "body": json.loads(body), "headers": headers, "timeout": timeout})
        answer = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(answer, Exception):
            raise answer
        payload = answer.get("body", [])
        raw = payload.encode() if isinstance(payload, str) else json.dumps(payload).encode()
        headers = {"Content-Type": "application/json"}
        headers.update(answer.get("headers", {}))
        return answer.get("status", 200), headers, raw


def client(transport, **kwargs):
    sleeps = []
    fp = FlightPowers("test-key", transport=transport, sleep=sleeps.append, **kwargs)
    fp.sleeps = sleeps
    return fp


ENDPOINTS = [
    ("flights", "oneway", {"from_airport": "JFK", "to_airport": "LHR", "departure_date": "2027-01-20"},
     HOSTS["flights"], "/api/google_flights/oneway/v1", "flights.oneway"),
    ("flights", "roundtrip", {"from_airport": "JFK", "to_airport": "LHR", "departure_date": "2027-01-20", "return_date": "2027-01-27"},
     HOSTS["flights"], "/api/google_flights/roundtrip/v1", "flights.roundtrip"),
    ("flights", "oneway_multi_airport", {"from_airport": ["TLV"], "to_airport": "ATH,SKG", "departure_date": "2027-01-20"},
     HOSTS["flights"], "/api/google_flights/oneway_multi_airport/v1", "flights.oneway_multi_airport"),
    ("flights", "roundtrip_multi_airport", {"from_airport": "TLV", "to_airport": ["ATH"], "departure_date": "2027-01-20", "return_date": "2027-01-27"},
     HOSTS["flights"], "/api/google_flights/roundtrip_multi_airport/v1", "flights.roundtrip_multi_airport"),
    ("booking", "search", {"destination": "Paris", "checkin_date": "2027-01-20", "checkout_date": "2027-01-23"},
     HOSTS["booking"], "/search", "booking.search"),
    ("booking", "hotel_by_name", {"hotel_name": "Kremlin Palace", "checkin_date": "2027-01-20", "checkout_date": "2027-01-23"},
     HOSTS["booking"], "/hotel_by_name", "booking.hotel_by_name"),
    ("booking", "resolve", {"hotel_name": "Four Seasons Limassol"}, HOSTS["booking"], "/resolve", "booking.resolve"),
    ("booking", "rooms", {"hotel_booking_id": "cy/four-seasons-limassol", "checkin_date": "2027-01-20", "checkout_date": "2027-01-23"},
     HOSTS["booking"], "/hotel", "booking.rooms"),
    ("airbnb", "search", {"destination": "Lisbon", "checkin_date": "2027-01-20", "checkout_date": "2027-01-23"},
     HOSTS["airbnb"], "/search", "airbnb.search"),
    ("airbnb", "details", {"listing_id": "12345"}, HOSTS["airbnb"], "/details", "airbnb.details"),
    ("google_hotels", "search", {"destination": "Barcelona", "checkin_date": "2027-01-20", "checkout_date": "2027-01-23"},
     HOSTS["google_hotels"], "/search", "google_hotels.search"),
    ("google_hotels", "rates", {"hotel_name": "Hotel Arts Barcelona", "destination": "Barcelona", "checkin_date": "2027-01-20", "checkout_date": "2027-01-23"},
     HOSTS["google_hotels"], "/rates", "google_hotels.rates"),
]

RETRY_503 = {"status": 503, "body": {"error": "search_incomplete", "retry": True}}


class EndpointTests(unittest.TestCase):
    def test_every_endpoint_posts_with_attribution(self):
        for ns, method, params, host, path, tool in ENDPOINTS:
            with self.subTest(tool=tool):
                transport = FakeTransport({"body": []})
                getattr(getattr(client(transport), ns), method)(**params)
                self.assertEqual(len(transport.calls), 1)
                call = transport.calls[0]
                self.assertEqual(call["url"], "https://" + host + path)
                self.assertEqual(call["headers"]["x-rapidapi-key"], "test-key")
                self.assertEqual(call["headers"]["x-rapidapi-host"], host)
                self.assertEqual(call["headers"]["content-type"], "application/json")
                self.assertEqual(call["body"], dict(params, _fp_source="sdk-py", _fp_tool=tool))

    def test_tags_pass_the_backends_filter(self):
        pattern = re.compile(r"^[a-z0-9][a-z0-9._/-]*$")
        for tag in [SOURCE_TAG] + [e[5] for e in ENDPOINTS]:
            self.assertTrue(pattern.match(tag) and len(tag) <= 40, tag)

    def test_none_arguments_are_not_sent(self):
        transport = FakeTransport({"body": []})
        client(transport).flights.oneway(from_airport="JFK", to_airport="LHR", departure_date="2027-01-20", max_stops=None, limit=5)
        body = transport.calls[0]["body"]
        self.assertNotIn("max_stops", body)
        self.assertEqual(body["limit"], 5)

    def test_extra_keyword_arguments_are_forwarded(self):
        transport = FakeTransport({"body": []})
        client(transport).flights.oneway_multi_airport(
            from_airport=("TLV", "HFA"), to_airport="ATH", departure_date="2027-01-20", limit=3, use_fallback=False
        )
        body = transport.calls[0]["body"]
        self.assertEqual(body["from_airport"], ["TLV", "HFA"])
        self.assertEqual(body["limit"], 3)
        self.assertIs(body["use_fallback"], False)

    def test_our_tags_win(self):
        transport = FakeTransport({"body": []})
        client(transport).booking.resolve(hotel_name="x", _fp_source="nope")
        self.assertEqual(transport.calls[0]["body"]["_fp_source"], "sdk-py")

    def test_rates_needs_a_name_or_an_id(self):
        with self.assertRaises(ValueError):
            client(FakeTransport()).google_hotels.rates(checkin_date="2027-01-20", checkout_date="2027-01-23")


class ResponseTests(unittest.TestCase):
    def test_meta_reads_search_and_quota_headers(self):
        transport = FakeTransport({
            "body": [{"price": "$433"}],
            "headers": {
                "X-Search-Status": "partial", "X-Search-Reason": "blocked_page", "X-Search-Results": "1",
                "X-Search-Notes": "via_rpc", "X-Search-Fallback": "used",
                "X-RateLimit-Requests-Remaining": "2499", "x-plan-quota": "2500",
            },
        })
        res = client(transport).flights.oneway(**ENDPOINTS[0][2])
        self.assertEqual(res.status, 200)
        self.assertEqual(res.data, [{"price": "$433"}])
        self.assertEqual(res.meta.search_status, "partial")
        self.assertEqual(res.meta.search_reason, "blocked_page")
        self.assertEqual(res.meta.search_results, 1)
        self.assertEqual(res.meta.search_notes, "via_rpc")
        self.assertEqual(res.meta.search_fallback, "used")
        self.assertEqual(res.meta.quota, {"x-ratelimit-requests-remaining": "2499", "x-plan-quota": "2500"})

    def test_meta_falls_back_to_the_body_envelope(self):
        transport = FakeTransport({"body": {"search_status": "empty", "search_reason": "no_results", "properties": []}})
        res = client(transport).airbnb.search(**ENDPOINTS[8][2])
        self.assertEqual(res.meta.search_status, "empty")
        self.assertEqual(res.meta.search_reason, "no_results")
        self.assertIsNone(res.meta.search_results)


class ErrorTests(unittest.TestCase):
    def test_422_raises_with_status_and_detail(self):
        transport = FakeTransport({"status": 422, "body": {"detail": "to_airport: LON is a city code", "field": "to_airport"}})
        with self.assertRaises(FlightPowersError) as ctx:
            client(transport).flights.roundtrip_multi_airport(**ENDPOINTS[3][2])
        err = ctx.exception
        self.assertEqual(err.status, 422)
        self.assertIn("HTTP 422: to_airport: LON is a city code", str(err))
        self.assertEqual(err.body["field"], "to_airport")
        self.assertIsNone(err.retry)

    def test_degraded_503_carries_headers_and_flag(self):
        transport = FakeTransport({
            "status": 503,
            "body": {"error": "search_incomplete", "search_status": "degraded", "retry": False},
            "headers": {"X-Search-Status": "degraded", "X-Search-Reason": "upstream_timeout"},
        })
        with self.assertRaises(FlightPowersError) as ctx:
            client(transport, max_retries=3).flights.oneway(**ENDPOINTS[0][2])
        err = ctx.exception
        self.assertEqual((err.status, err.search_status, err.search_reason, err.retry), (503, "degraded", "upstream_timeout", False))
        self.assertEqual(len(transport.calls), 1)

    def test_lite_lane_502_reads_the_body(self):
        transport = FakeTransport({"status": 502, "body": {"search_status": "degraded", "search_reason": "upstream_error", "properties": []}})
        with self.assertRaises(FlightPowersError) as ctx:
            client(transport).google_hotels.rates(**ENDPOINTS[11][2])
        self.assertEqual((ctx.exception.status, ctx.exception.search_status), (502, "degraded"))

    def test_no_retry_by_default(self):
        transport = FakeTransport(RETRY_503, {"body": []})
        with self.assertRaises(FlightPowersError) as ctx:
            client(transport).flights.oneway(**ENDPOINTS[0][2])
        self.assertIs(ctx.exception.retry, True)
        self.assertEqual(len(transport.calls), 1)

    def test_retries_a_503_that_says_retry_then_succeeds(self):
        transport = FakeTransport(RETRY_503, RETRY_503, {"body": [{"price": "$1"}]})
        fp = client(transport, max_retries=2, retry_delay=0.5)
        res = fp.flights.oneway(**ENDPOINTS[0][2])
        self.assertEqual(len(transport.calls), 3)
        self.assertEqual(res.data, [{"price": "$1"}])
        self.assertEqual(fp.sleeps, [0.5, 1.0])

    def test_retry_after_header_wins(self):
        transport = FakeTransport(dict(RETRY_503, headers={"Retry-After": "7"}), {"body": []})
        fp = client(transport, max_retries=1)
        fp.booking.search(**ENDPOINTS[4][2])
        self.assertEqual(fp.sleeps, [7.0])

    def test_stops_at_the_limit(self):
        transport = FakeTransport(RETRY_503)
        with self.assertRaises(FlightPowersError):
            client(transport, max_retries=2).flights.oneway(**ENDPOINTS[0][2])
        self.assertEqual(len(transport.calls), 3)

    def test_max_retries_is_capped_at_ten(self):
        for value in (float("inf"), 10**9, 10):
            with self.subTest(value=value):
                transport = FakeTransport(RETRY_503)
                with self.assertRaises(FlightPowersError):
                    client(transport, max_retries=value, retry_delay=0).flights.oneway(**ENDPOINTS[0][2])
                self.assertEqual(len(transport.calls), 11)
        transport = FakeTransport(RETRY_503)
        with self.assertRaises(FlightPowersError):
            client(transport, retry_delay=0).request("flights", "/x", {}, "t", max_retries=float("inf"))
        self.assertEqual(len(transport.calls), 11)
        transport = FakeTransport(RETRY_503)
        with self.assertRaises(FlightPowersError):
            client(transport, max_retries=float("nan")).flights.oneway(**ENDPOINTS[0][2])
        self.assertEqual(len(transport.calls), 1)

    def test_computed_wait_is_capped_at_sixty_seconds(self):
        transport = FakeTransport(RETRY_503)
        fp = client(transport, max_retries=4, retry_delay=20)
        with self.assertRaises(FlightPowersError):
            fp.flights.oneway(**ENDPOINTS[0][2])
        self.assertEqual(fp.sleeps, [20, 40, 60.0, 60.0])

    def test_other_failures_are_never_retried(self):
        for answer in (
            {"status": 503, "body": {"retry": False}},
            {"status": 503, "body": {"error": "x"}},
            {"status": 502, "body": {"retry": True}},
            {"status": 429, "body": {"message": "quota"}},
        ):
            with self.subTest(answer=answer):
                transport = FakeTransport(answer, {"body": []})
                with self.assertRaises(FlightPowersError):
                    client(transport, max_retries=3).booking.resolve(hotel_name="x")
                self.assertEqual(len(transport.calls), 1)

    def test_network_failure_is_status_zero(self):
        transport = FakeTransport(OSError("ECONNRESET"))
        with self.assertRaises(FlightPowersError) as ctx:
            client(transport).airbnb.details(listing_id="1")
        self.assertEqual(ctx.exception.status, 0)
        self.assertIn("ECONNRESET", str(ctx.exception))

    def test_non_json_body_is_kept_as_text(self):
        transport = FakeTransport({"status": 500, "body": "Internal Server Error"})
        with self.assertRaises(FlightPowersError) as ctx:
            client(transport).booking.search(**ENDPOINTS[4][2])
        self.assertEqual(ctx.exception.body, "Internal Server Error")


class ClientTests(unittest.TestCase):
    def test_key_is_required(self):
        with self.assertRaises(ValueError):
            FlightPowers("")

    def test_base_url_override_keeps_the_host_header(self):
        transport = FakeTransport({"body": []})
        FlightPowers("k", transport=transport, base_urls={"booking": "http://localhost:9/"}).booking.search(**ENDPOINTS[4][2])
        self.assertEqual(transport.calls[0]["url"], "http://localhost:9/search")
        self.assertEqual(transport.calls[0]["headers"]["x-rapidapi-host"], HOSTS["booking"])

    def test_unknown_product_is_refused(self):
        with self.assertRaises(ValueError):
            FlightPowers("k", base_urls={"nope": "http://x"})

    def test_version(self):
        import flightpowers
        self.assertEqual(flightpowers.__version__, VERSION)


class UrllibTransportTests(unittest.TestCase):
    """The real transport against a local server: 2xx and 4xx both come back as answers."""

    def test_round_trip_through_a_local_server(self):
        import threading
        from http.server import BaseHTTPRequestHandler, HTTPServer

        seen = {}

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                length = int(self.headers["content-length"])
                seen["body"] = json.loads(self.rfile.read(length))
                seen["host"] = self.headers["x-rapidapi-host"]
                status = 422 if seen["body"].get("bad") else 200
                payload = json.dumps({"detail": "bad"} if status == 422 else [{"ok": 1}]).encode()
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.send_header("X-Search-Status", "ok")
                self.send_header("content-length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, *args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            base = "http://127.0.0.1:{}".format(server.server_address[1])
            fp = FlightPowers("k", base_urls={"flights": base})
            res = fp.flights.oneway(**ENDPOINTS[0][2])
            self.assertEqual((res.status, res.data, res.meta.search_status), (200, [{"ok": 1}], "ok"))
            self.assertEqual(seen["body"]["_fp_tool"], "flights.oneway")
            self.assertEqual(seen["host"], HOSTS["flights"])
            with self.assertRaises(FlightPowersError) as ctx:
                fp.flights.oneway(bad=True, **ENDPOINTS[0][2])
            self.assertEqual(ctx.exception.status, 422)
        finally:
            server.shutdown()
            server.server_close()


# Copied from https://flightpowers.com/llms-full.txt, /v1/hotels/search "filters" (2026-11-08),
# which matches hotel_agent nodejs_mvp/main.js FILTER_MAP.
DOCS_BOOKING_FILTERS = (
    "free_cancellation | breakfast_included | breakfast_and_lunch | breakfast_and_dinner | all_meals_included | "
    "all_inclusive | free_wifi | swimming_pool | gym | parking | front_desk_24h | review_score_7 | review_score_8 | "
    "review_score_9 | private_bathroom | air_conditioning | stars_3 | stars_4 | stars_5 | pets_allowed | adults_only | "
    "sauna | very_good_breakfast | accepts_online_payment"
)


class BookingFiltersTest(unittest.TestCase):
    def test_exactly_the_24_documented_names(self):
        docs = DOCS_BOOKING_FILTERS.split(" | ")
        self.assertEqual(len(docs), 24)
        self.assertEqual(list(BOOKING_FILTERS), docs)
        self.assertNotIn("accepts_online_pay", BOOKING_FILTERS)


if __name__ == "__main__":
    unittest.main()
