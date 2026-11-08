const { test } = require("node:test");
const assert = require("node:assert/strict");

test("the CommonJS build loads and exposes the same surface", () => {
  const sdk = require("../dist/cjs/index.js");
  assert.equal(typeof sdk.FlightPowers, "function");
  assert.equal(typeof sdk.FlightPowersError, "function");
  const fp = new sdk.FlightPowers({ rapidApiKey: "k", fetch: async () => new Response("[]") });
  assert.equal(typeof fp.flights.oneway, "function");
  assert.equal(typeof fp.googleHotels.rates, "function");
});

test("require('flightpowers') resolves to the CommonJS build", () => {
  const resolved = require.resolve("flightpowers");
  assert.match(resolved, /dist[\\/]cjs[\\/]index\.js$/);
});
