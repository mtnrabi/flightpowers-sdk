# FlightPowers SDK

Official client libraries for the FlightPowers APIs: live Google Flights, Booking.com, Airbnb and Google Hotels data as JSON, through your own RapidAPI key.

| Language | Package | Folder |
|---|---|---|
| JavaScript / TypeScript | `npm install flightpowers` | [`js/`](js/) |
| Python | `pip install flightpowers` | [`py/`](py/) |

Both packages have the same surface: one client, four namespaces (`flights`, `booking`, `airbnb`, `googleHotels` / `google_hotels`), one method per endpoint, the `X-Search-*` headers read for you, and one error type that carries the HTTP status and the search status.

```ts
import { FlightPowers } from "flightpowers";
const fp = new FlightPowers({ rapidApiKey: process.env.RAPIDAPI_KEY! });
const { data, meta } = await fp.flights.oneway({ from_airport: "JFK", to_airport: "LHR", departure_date: "2027-01-20" });
```

```python
from flightpowers import FlightPowers
fp = FlightPowers("<your RapidAPI key>")
res = fp.flights.oneway(from_airport="JFK", to_airport="LHR", departure_date="2027-01-20")
```

## Pricing

Every listing has a free BASIC plan, then plans from $10 a month on each RapidAPI listing. See https://flightpowers.com/pricing.

- Google Flights: https://rapidapi.com/mtnrabi/api/google-flights-live-api
- Booking.com: https://rapidapi.com/mtnrabi/api/booking-live-api
- Airbnb: https://rapidapi.com/mtnrabi/api/airbnb-live-api
- Google Hotels: https://rapidapi.com/mtnrabi/api/google-hotels-live-api

## Docs

- SDK guide: https://flightpowers.com/docs/sdks
- API docs: https://flightpowers.com/docs (full reference: https://flightpowers.com/llms-full.txt)

The multi-airport flight endpoints take a party with a child or an infant and round trips over 32 nights, searched pair by pair on Google's own search call (`via_rpc` in the search notes, no price range on those rows, up to about a minute). Details in each package README.

## Development

```sh
cd js && npm ci && npm test        # Node 18+
cd py && PYTHONPATH=src python -m unittest discover -s tests   # Python 3.9+
```

`js/scripts/live-smoke.mjs` and `py/scripts/live_smoke.py` make one real (metered) call per product with `RAPIDAPI_KEY` from the environment. They are not run in CI.

Releases: a GitHub release tagged `vX.Y.Z` publishes both packages (`.github/workflows/publish-npm.yml`, `publish-pypi.yml`); the tag must equal the version in `js/package.json` and `py/src/flightpowers/_client.py`. Nothing else publishes: there is no manual run, and the `npm` and `pypi` environments only accept `v*` tags. Both registries publish through trusted publishing (OIDC, no stored token): npm with `--provenance`, PyPI through `pypa/gh-action-pypi-publish`. 0.1.0 was published to npm by hand; from 0.1.1 on, npm publishes through its trusted publisher. See [CHANGELOG.md](CHANGELOG.md).

## License

MIT
