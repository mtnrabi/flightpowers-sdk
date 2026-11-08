// One real, metered call per product through the RapidAPI hosts.
// Not run in CI. Usage: RAPIDAPI_KEY=... node scripts/live-smoke.mjs  (after npm run build)
// Prints status and search status only, never the key.
import { FlightPowers, FlightPowersError } from "../dist/esm/index.js";

const key = process.env.RAPIDAPI_KEY;
if (!key) {
  console.error("RAPIDAPI_KEY is not set");
  process.exit(2);
}
const fp = new FlightPowers({ rapidApiKey: key });
const stay = { checkin_date: "2027-01-20", checkout_date: "2027-01-23" };

const calls = [
  ["flights.oneway", () => fp.flights.oneway({ from_airport: "JFK", to_airport: "LHR", departure_date: "2027-01-20", limit: 3 }),
    (d) => (Array.isArray(d) ? d.length : null)],
  ["booking.search", () => fp.booking.search({ destination: "Paris", ...stay }), (d) => d?.properties?.length ?? null],
  ["airbnb.search", () => fp.airbnb.search({ destination: "Lisbon", ...stay }), (d) => d?.properties?.length ?? null],
  ["google_hotels.rates", () => fp.googleHotels.rates({ hotel_name: "Hotel Arts Barcelona", destination: "Barcelona", ...stay }),
    (d) => d?.properties?.[0]?.sites?.length ?? 0],
];

let failed = 0;
for (const [name, run, count] of calls) {
  const started = Date.now();
  try {
    const res = await run();
    console.log(JSON.stringify({
      call: name, status: res.status, search_status: res.meta.searchStatus, search_reason: res.meta.searchReason,
      rows: count(res.data), ms: Date.now() - started,
    }));
  } catch (err) {
    failed++;
    const e = err instanceof FlightPowersError ? err : { status: "?", message: String(err) };
    console.log(JSON.stringify({ call: name, status: e.status, search_status: e.searchStatus ?? null, error: e.message, ms: Date.now() - started }));
  }
}
process.exit(failed ? 1 : 0);
