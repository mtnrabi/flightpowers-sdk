# Changelog

Both packages (`flightpowers` on npm and on PyPI) share one version.

## 0.1.1 (2026-11-08)

- Docs: the READMEs link to the SDK guide, https://flightpowers.com/docs/sdks, and the package homepage (npm `homepage`, PyPI `Homepage`) points there.
- Docs: the READMEs say that the multi-airport flight endpoints take a party with a child or an infant (passenger codes 2, 3, 4) and round trips over 32 nights, searched pair by pair on Google's own search call (`via_rpc` in the search notes, no price range on those rows, up to about a minute), as the API docs describe. No code change: the SDK already passed these requests through.
- Release: the first release published by both registries' trusted publishers (OIDC, no stored token), with npm provenance.

## 0.1.0 (2026-11-08)

- First release: one client, four namespaces (`flights`, `booking`, `airbnb`, `googleHotels` / `google_hotels`).
