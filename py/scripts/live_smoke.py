"""One real, metered call per product through the RapidAPI hosts.

Not run in CI. Usage: RAPIDAPI_KEY=... python scripts/live_smoke.py
Prints status and search status only, never the key.
"""

import json
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src"))

from flightpowers import FlightPowers, FlightPowersError  # noqa: E402

key = os.environ.get("RAPIDAPI_KEY")
if not key:
    sys.exit("RAPIDAPI_KEY is not set")
fp = FlightPowers(key)
stay = {"checkin_date": "2027-01-20", "checkout_date": "2027-01-23"}


def props(d):
    return len(d.get("properties", [])) if isinstance(d, dict) else None


def sites(d):
    rows = d.get("properties", []) if isinstance(d, dict) else []
    return len(rows[0].get("sites", [])) if rows else 0


calls = [
    ("flights.oneway", lambda: fp.flights.oneway(from_airport="JFK", to_airport="LHR", departure_date="2027-01-20", limit=3),
     lambda d: len(d) if isinstance(d, list) else None),
    ("booking.search", lambda: fp.booking.search(destination="Paris", **stay), props),
    ("airbnb.search", lambda: fp.airbnb.search(destination="Lisbon", **stay), props),
    ("google_hotels.rates", lambda: fp.google_hotels.rates(hotel_name="Hotel Arts Barcelona", destination="Barcelona", **stay), sites),
]

failed = 0
for name, run, count in calls:
    started = time.time()
    try:
        res = run()
        print(json.dumps({"call": name, "status": res.status, "search_status": res.meta.search_status,
                          "search_reason": res.meta.search_reason, "rows": count(res.data),
                          "ms": int((time.time() - started) * 1000)}))
    except FlightPowersError as err:
        failed += 1
        print(json.dumps({"call": name, "status": err.status, "search_status": err.search_status,
                          "error": err.message, "ms": int((time.time() - started) * 1000)}))
sys.exit(1 if failed else 0)
