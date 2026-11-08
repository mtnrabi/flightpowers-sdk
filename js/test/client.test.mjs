import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FlightPowers, FlightPowersError, HOSTS, SOURCE_TAG, VERSION } from "../dist/esm/index.js";

/** A fetch stand-in that records calls and answers from a queue. */
function mockFetch(...answers) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init, body: JSON.parse(init.body) });
    const next = answers.length > 1 ? answers.shift() : answers[0];
    if (next instanceof Error) throw next;
    const { status = 200, body = [], headers = {} } = next ?? {};
    return new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  };
  fn.calls = calls;
  return fn;
}

const client = (fetch, extra = {}) =>
  new FlightPowers({ rapidApiKey: "test-key", fetch, retryDelayMs: 0, ...extra });

// Every endpoint: [namespace, method, params, host, path, tool].
const ENDPOINTS = [
  ["flights", "oneway", { from_airport: "JFK", to_airport: "LHR", departure_date: "2027-01-20" },
    HOSTS.flights, "/api/google_flights/oneway/v1", "flights.oneway"],
  ["flights", "roundtrip", { from_airport: "JFK", to_airport: "LHR", departure_date: "2027-01-20", return_date: "2027-01-27" },
    HOSTS.flights, "/api/google_flights/roundtrip/v1", "flights.roundtrip"],
  ["flights", "onewayMultiAirport", { from_airport: ["TLV"], to_airport: "ATH,SKG", departure_date: "2027-01-20" },
    HOSTS.flights, "/api/google_flights/oneway_multi_airport/v1", "flights.oneway_multi_airport"],
  ["flights", "roundtripMultiAirport", { from_airport: "TLV", to_airport: ["ATH"], departure_date: "2027-01-20", return_date: "2027-01-27" },
    HOSTS.flights, "/api/google_flights/roundtrip_multi_airport/v1", "flights.roundtrip_multi_airport"],
  ["booking", "search", { destination: "Paris", checkin_date: "2027-01-20", checkout_date: "2027-01-23" },
    HOSTS.booking, "/search", "booking.search"],
  ["booking", "hotelByName", { hotel_name: "Kremlin Palace", checkin_date: "2027-01-20", checkout_date: "2027-01-23" },
    HOSTS.booking, "/hotel_by_name", "booking.hotel_by_name"],
  ["booking", "resolve", { hotel_name: "Four Seasons Limassol" }, HOSTS.booking, "/resolve", "booking.resolve"],
  ["booking", "rooms", { hotel_booking_id: "cy/four-seasons-limassol", checkin_date: "2027-01-20", checkout_date: "2027-01-23" },
    HOSTS.booking, "/hotel", "booking.rooms"],
  ["airbnb", "search", { destination: "Lisbon", checkin_date: "2027-01-20", checkout_date: "2027-01-23" },
    HOSTS.airbnb, "/search", "airbnb.search"],
  ["airbnb", "details", { listing_id: "12345" }, HOSTS.airbnb, "/details", "airbnb.details"],
  ["googleHotels", "search", { destination: "Barcelona", checkin_date: "2027-01-20", checkout_date: "2027-01-23" },
    HOSTS.googleHotels, "/search", "google_hotels.search"],
  ["googleHotels", "rates", { hotel_name: "Hotel Arts Barcelona", destination: "Barcelona", checkin_date: "2027-01-20", checkout_date: "2027-01-23" },
    HOSTS.googleHotels, "/rates", "google_hotels.rates"],
];

for (const [ns, method, params, host, path, tool] of ENDPOINTS) {
  test(`${ns}.${method} posts to ${host}${path} with attribution`, async () => {
    const fetch = mockFetch({ body: [] });
    await client(fetch)[ns][method](params);
    assert.equal(fetch.calls.length, 1);
    const [{ url, init, body }] = fetch.calls;
    assert.equal(url, `https://${host}${path}`);
    assert.equal(init.method, "POST");
    assert.equal(init.headers["x-rapidapi-key"], "test-key");
    assert.equal(init.headers["x-rapidapi-host"], host);
    assert.equal(init.headers["content-type"], "application/json");
    assert.deepEqual(body, { ...params, _fp_source: "sdk-js", _fp_tool: tool });
  });
}

test("attribution tags pass the backends' tag filter", () => {
  // hotel_agent source_tag.js TAG_PATTERN and length cap; flights keeps the same alphabet.
  const pattern = /^[a-z0-9][a-z0-9._/-]*$/;
  for (const tag of [SOURCE_TAG, ...ENDPOINTS.map((e) => e[5])]) {
    assert.ok(pattern.test(tag) && tag.length <= 40, tag);
  }
});

test("our tags win over caller-supplied ones", async () => {
  const fetch = mockFetch({ body: [] });
  await client(fetch).flights.oneway({ from_airport: "JFK", to_airport: "LHR", departure_date: "2027-01-20", _fp_source: "x" });
  assert.equal(fetch.calls[0].body._fp_source, "sdk-js");
});

test("meta reads the search and quota headers", async () => {
  const fetch = mockFetch({
    body: [{ price: "$433" }],
    headers: {
      "X-Search-Status": "partial",
      "X-Search-Reason": "blocked_page",
      "X-Search-Results": "1",
      "X-Search-Notes": "via_rpc",
      "X-Search-Fallback": "used",
      "x-ratelimit-requests-remaining": "2499",
      "x-plan-quota": "2500",
    },
  });
  const res = await client(fetch).flights.oneway(ENDPOINTS[0][2]);
  assert.equal(res.status, 200);
  assert.deepEqual(res.data, [{ price: "$433" }]);
  assert.equal(res.meta.searchStatus, "partial");
  assert.equal(res.meta.searchReason, "blocked_page");
  assert.equal(res.meta.searchResults, 1);
  assert.equal(res.meta.searchNotes, "via_rpc");
  assert.equal(res.meta.searchFallback, "used");
  assert.deepEqual(res.meta.quota, { "x-plan-quota": "2500", "x-ratelimit-requests-remaining": "2499" });
});

test("meta falls back to the body envelope (Airbnb, Google Hotels)", async () => {
  const fetch = mockFetch({ body: { search_status: "empty", search_reason: "no_results", properties: [] } });
  const res = await client(fetch).airbnb.search(ENDPOINTS[8][2]);
  assert.equal(res.meta.searchStatus, "empty");
  assert.equal(res.meta.searchReason, "no_results");
  assert.equal(res.meta.searchResults, null);
});

test("a 422 throws FlightPowersError with status and detail", async () => {
  const fetch = mockFetch({ status: 422, body: { detail: "to_airport: LON is a city code", field: "to_airport" } });
  await assert.rejects(client(fetch).flights.roundtripMultiAirport(ENDPOINTS[3][2]), (err) => {
    assert.ok(err instanceof FlightPowersError);
    assert.equal(err.status, 422);
    assert.match(err.message, /HTTP 422: to_airport: LON is a city code/);
    assert.equal(err.body.field, "to_airport");
    assert.equal(err.retry, null);
    return true;
  });
});

test("a FastAPI list detail is stringified into the message", async () => {
  const fetch = mockFetch({ status: 422, body: { detail: [{ loc: ["body", "departure_date"], msg: "bad" }] } });
  await assert.rejects(client(fetch).flights.oneway(ENDPOINTS[0][2]), /departure_date/);
});

test("a degraded 503 carries the search headers and the retry flag", async () => {
  const fetch = mockFetch({
    status: 503,
    body: { error: "search_incomplete", search_status: "degraded", search_reason: "upstream_timeout", retry: false },
    headers: { "X-Search-Status": "degraded", "X-Search-Reason": "upstream_timeout" },
  });
  await assert.rejects(client(fetch).flights.oneway(ENDPOINTS[0][2]), (err) => {
    assert.equal(err.status, 503);
    assert.equal(err.searchStatus, "degraded");
    assert.equal(err.searchReason, "upstream_timeout");
    assert.equal(err.retry, false);
    return true;
  });
  assert.equal(fetch.calls.length, 1);
});

test("a lite-lane 502 reads search_status from the body", async () => {
  const fetch = mockFetch({ status: 502, body: { search_status: "degraded", search_reason: "upstream_error", properties: [] } });
  await assert.rejects(client(fetch).googleHotels.rates(ENDPOINTS[11][2]), (err) => {
    assert.equal(err.status, 502);
    assert.equal(err.searchStatus, "degraded");
    assert.equal(err.searchReason, "upstream_error");
    return true;
  });
});

const retry503 = { status: 503, body: { error: "search_incomplete", retry: true } };

test("no retry by default, even when the body says retry: true", async () => {
  const fetch = mockFetch(retry503, { body: [] });
  await assert.rejects(client(fetch).flights.oneway(ENDPOINTS[0][2]), (err) => err.retry === true);
  assert.equal(fetch.calls.length, 1);
});

test("maxRetries repeats a 503 that says retry: true, then succeeds", async () => {
  const fetch = mockFetch(retry503, retry503, { body: [{ price: "$1" }] });
  const res = await client(fetch, { maxRetries: 2 }).flights.oneway(ENDPOINTS[0][2]);
  assert.equal(fetch.calls.length, 3);
  assert.deepEqual(res.data, [{ price: "$1" }]);
});

test("maxRetries stops at the limit and throws the last error", async () => {
  const fetch = mockFetch(retry503);
  await assert.rejects(client(fetch, { maxRetries: 2 }).flights.oneway(ENDPOINTS[0][2]), (err) => err.status === 503);
  assert.equal(fetch.calls.length, 3);
});

test("retry: false, a 503 without the flag, a 502 and a 429 are never retried", async () => {
  for (const answer of [
    { status: 503, body: { retry: false } },
    { status: 503, body: { error: "x" } },
    { status: 502, body: { retry: true } },
    { status: 429, body: { message: "quota" } },
  ]) {
    const fetch = mockFetch(answer, { body: [] });
    await assert.rejects(client(fetch, { maxRetries: 3 }).booking.resolve(ENDPOINTS[6][2]));
    assert.equal(fetch.calls.length, 1, JSON.stringify(answer));
  }
});

test("per-call maxRetries overrides the client", async () => {
  const fetch = mockFetch(retry503, { body: [] });
  await client(fetch).booking.search(ENDPOINTS[4][2], { maxRetries: 1 });
  assert.equal(fetch.calls.length, 2);
});

test("a network failure throws FlightPowersError with status 0", async () => {
  const fetch = mockFetch(new Error("ECONNRESET"));
  await assert.rejects(client(fetch).airbnb.details(ENDPOINTS[9][2]), (err) => {
    assert.ok(err instanceof FlightPowersError);
    assert.equal(err.status, 0);
    assert.match(err.message, /ECONNRESET/);
    return true;
  });
});

test("a timeout aborts the request", async () => {
  const fetch = (_url, init) =>
    new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)));
  await assert.rejects(client(fetch, { timeoutMs: 20 }).flights.oneway(ENDPOINTS[0][2]), /timed out after 20 ms/);
});

test("a non-JSON error body is kept as text", async () => {
  const fetch = mockFetch({ status: 500, body: "Internal Server Error" });
  await assert.rejects(client(fetch).booking.search(ENDPOINTS[4][2]), (err) => {
    assert.equal(err.body, "Internal Server Error");
    assert.match(err.message, /HTTP 500: Internal Server Error/);
    return true;
  });
});

test("the key is required", () => {
  assert.throws(() => new FlightPowers({ rapidApiKey: "" }), /rapidApiKey is required/);
  assert.throws(() => new FlightPowers(), /rapidApiKey is required/);
});

test("baseUrls override a host (the host header stays the listing's)", async () => {
  const fetch = mockFetch({ body: [] });
  await client(fetch, { baseUrls: { booking: "http://localhost:9/" } }).booking.search(ENDPOINTS[4][2]);
  assert.equal(fetch.calls[0].url, "http://localhost:9/search");
  assert.equal(fetch.calls[0].init.headers["x-rapidapi-host"], HOSTS.booking);
});

test("VERSION matches package.json", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url)));
  assert.equal(VERSION, pkg.version);
});
