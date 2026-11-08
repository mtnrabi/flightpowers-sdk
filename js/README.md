# flightpowers (JavaScript / TypeScript)

Official client for the FlightPowers APIs: live Google Flights, Booking.com, Airbnb and Google Hotels data as JSON, through your own RapidAPI key.

- Zero runtime dependencies. Uses the global `fetch` (Node 18+, browsers, Deno, Bun).
- ESM and CommonJS builds, TypeScript types included.
- Docs: https://flightpowers.com/docs/sdks (SDK guide) and https://flightpowers.com/docs

## Install

```sh
npm install flightpowers
```

## Get a key

Subscribe to the listing you need on RapidAPI and copy your key. Every listing has a free BASIC plan, then plans from $10 a month on each RapidAPI listing (see https://flightpowers.com/pricing). One key works on every listing you subscribe to.

| Namespace | RapidAPI listing |
|---|---|
| `flights` | https://rapidapi.com/mtnrabi/api/google-flights-live-api |
| `booking` | https://rapidapi.com/mtnrabi/api/booking-live-api |
| `airbnb` | https://rapidapi.com/mtnrabi/api/airbnb-live-api |
| `googleHotels` | https://rapidapi.com/mtnrabi/api/google-hotels-live-api |

## Quickstart

### Google Flights

```ts
import { FlightPowers } from "flightpowers";
const fp = new FlightPowers({ rapidApiKey: process.env.RAPIDAPI_KEY! });
const { data, meta } = await fp.flights.oneway({ from_airport: "JFK", to_airport: "LHR", departure_date: "2027-01-20" });
console.log(meta.searchStatus, data[0]?.price, data[0]?.price_range_in_relation_to_other_periods);
console.log(data[0]?.buy_link);
```

Round trips (`fp.flights.roundtrip`) come back with both legs paired and one total per row. `onewayMultiAirport` / `roundtripMultiAirport` take 1 to 4 airports a side in one request. They also take a party with a child or an infant (passenger codes 2, 3, 4) and round trips over 32 nights: those are searched pair by pair on Google's own search call, as on the single-airport endpoints, with `meta.searchNotes` set to `via_rpc`, no price range on those rows, and up to about a minute per call. Leave `use_fallback` out for them: on the round trip, `use_fallback: false` keeps an adults' stay over 32 nights on Google's page only (on many routes a 503 `upstream_no_render`).

### Booking.com

```ts
import { FlightPowers } from "flightpowers";
const fp = new FlightPowers({ rapidApiKey: process.env.RAPIDAPI_KEY! });
const { data } = await fp.booking.search({ destination: "Paris", checkin_date: "2027-01-20", checkout_date: "2027-01-23" });
for (const p of data.properties.slice(0, 3)) console.log(p.name, p.price_string, p.review_score);
// Also: fp.booking.hotelByName, fp.booking.resolve, fp.booking.rooms
```

### Airbnb

```ts
import { FlightPowers } from "flightpowers";
const fp = new FlightPowers({ rapidApiKey: process.env.RAPIDAPI_KEY! });
const { data } = await fp.airbnb.search({ destination: "Lisbon", checkin_date: "2027-01-20", checkout_date: "2027-01-23", min_bedrooms: 2 });
for (const p of data.properties.slice(0, 3)) console.log(p.name, p.price_total, p.currency, p.link);
// Also: fp.airbnb.details({ listing_id })
```

### Google Hotels

```ts
import { FlightPowers } from "flightpowers";
const fp = new FlightPowers({ rapidApiKey: process.env.RAPIDAPI_KEY! });
const { data } = await fp.googleHotels.rates({ hotel_name: "Hotel Arts Barcelona", destination: "Barcelona", checkin_date: "2027-01-20", checkout_date: "2027-01-23" });
for (const s of data.properties[0]?.sites ?? []) console.log(s.site, s.price_total, s.link);
// Also: fp.googleHotels.search({ destination, checkin_date, checkout_date })
```

## Responses

Every method resolves to `{ data, status, meta, headers }`:

- `data`: the parsed JSON body.
- `meta.searchStatus`: `ok`, `empty`, `partial` or `degraded`, from the `X-Search-Status` header (or the body's `search_status` on Airbnb and Google Hotels). `empty` means the search finished and there is nothing; `degraded` means the search did not finish, so an empty list says nothing about availability.
- Booking.com sends no search status, so `meta.searchStatus` is `null` on every Booking method. A Booking search whose page gave no properties answers HTTP 404 (`No properties found...`), which throws `FlightPowersError`; a search where every room is over `budget_per_night` comes back as an empty list.
- `meta.searchReason`, `meta.searchResults`, `meta.searchNotes`, `meta.searchFallback`: the other `X-Search-*` headers.
- `meta.quota`: the RapidAPI `x-ratelimit-*` / `x-plan-*` headers, when present.

## Errors and retries

Any non-2xx answer throws `FlightPowersError` with `status`, `searchStatus`, `searchReason`, `retry` (the API's own flag from the body) and `body`. A request that got no answer has `status` 0.

```ts
import { FlightPowers, FlightPowersError } from "flightpowers";
try {
  await fp.flights.oneway({ from_airport: "JFK", to_airport: "LHR", departure_date: "2027-01-20", strict: true });
} catch (err) {
  if (err instanceof FlightPowersError) console.log(err.status, err.searchStatus, err.searchReason, err.retry);
}
```

Retries are off by default. `new FlightPowers({ rapidApiKey, maxRetries: 2 })` (or `{ maxRetries }` as the second argument of any method) repeats a request only when it answered HTTP 503 with `"retry": true` in its body, waiting `Retry-After` when sent, else 1 s, then 2 s (each wait capped at 60 s, at most 10 retries). Nothing else is retried: a 429 would spend more quota, and a 4xx needs a fixed request.

Options: `timeoutMs` (total time per attempt, default 180000), `retryDelayMs` (default 1000), `fetch` (your own implementation), `baseUrls` (tests and proxies).

## Usage attribution

Each request body carries two extra fields, `_fp_source: "sdk-js"` and `_fp_tool: "<namespace>.<method>"`, so we can count how the SDK is used. The API removes them before it reads your request; they never change a search.

## Docs

- SDK guide: https://flightpowers.com/docs/sdks
- Flights: https://flightpowers.com/flights-api and https://flightpowers.com/flights-api/multi-airport
- Booking.com: https://flightpowers.com/hotels-api and https://flightpowers.com/hotels-api/by-name
- Airbnb: https://flightpowers.com/hotels-api/airbnb
- Google Hotels: https://flightpowers.com/hotels-api/google-hotels
- Full reference: https://flightpowers.com/llms-full.txt

## License

MIT
