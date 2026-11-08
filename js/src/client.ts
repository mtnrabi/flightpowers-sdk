import { FlightPowersError, isObject } from "./errors.js";
import type {
  AirbnbDetailsParams,
  AirbnbProperty,
  AirbnbSearchParams,
  BookingSearchParams,
  BookingSearchResult,
  FlightPowersResponse,
  GoogleHotelsProperty,
  GoogleHotelsRatesParams,
  GoogleHotelsRatesResult,
  GoogleHotelsSearchParams,
  HotelByNameParams,
  HotelByNameResult,
  OnewayFlight,
  OnewayMultiAirportParams,
  OnewayParams,
  ProviderEnvelope,
  ResolveParams,
  ResolveResult,
  ResponseMeta,
  RoomsParams,
  RoomsResult,
  RoundtripFlight,
  RoundtripMultiAirportParams,
  RoundtripParams,
} from "./types.js";

export const VERSION = "0.1.0";

/** Value of `_fp_source` on every request this package sends. */
export const SOURCE_TAG = "sdk-js";

export type Product = "flights" | "booking" | "airbnb" | "googleHotels";

/** The RapidAPI host of each listing. One key works on every listing you subscribe to. */
export const HOSTS: Readonly<Record<Product, string>> = Object.freeze({
  flights: "google-flights-live-api.p.rapidapi.com",
  booking: "booking-live-api.p.rapidapi.com",
  airbnb: "airbnb-live-api.p.rapidapi.com",
  googleHotels: "google-hotels-live-api.p.rapidapi.com",
});

export interface FlightPowersOptions {
  /** Your RapidAPI key (https://rapidapi.com/developer/apps). */
  rapidApiKey: string;
  /**
   * How many times to repeat a request that answered HTTP 503 with
   * `"retry": true` in its body. Default 0 (never). Nothing else is retried:
   * a 429 spends quota, a 4xx needs a fixed request.
   */
  maxRetries?: number;
  /** Base wait before a retry, doubled each time; a `Retry-After` header wins. Default 1000 ms. */
  retryDelayMs?: number;
  /** Per-request timeout. Default 180000 ms (RapidAPI's own proxy limit). */
  timeoutMs?: number;
  /** A `fetch` implementation. Default: the global `fetch` (Node 18+, browsers, Deno, Bun). */
  fetch?: typeof fetch;
  /** Override a listing's base URL (tests, proxies). Default `https://<host>`. */
  baseUrls?: Partial<Record<Product, string>>;
}

export interface RequestOptions {
  /** Abort the request. */
  signal?: AbortSignal;
  /** Override the client's `maxRetries` for this call. */
  maxRetries?: number;
  /** Override the client's `timeoutMs` for this call. */
  timeoutMs?: number;
}

const QUOTA_HEADER = /^(x-ratelimit-|x-plan-)/i;

function header(headers: Headers, name: string): string | null {
  const value = headers.get(name);
  return value === null || value === "" ? null : value;
}

/** Search metadata from the headers, falling back to a body envelope's fields. */
export function readMeta(headers: Headers, body: unknown): ResponseMeta {
  const quota: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (QUOTA_HEADER.test(key)) quota[key.toLowerCase()] = value;
  });
  const envelope = isObject(body) ? body : {};
  const bodyString = (key: string): string | null =>
    typeof envelope[key] === "string" ? (envelope[key] as string) : null;
  const results = header(headers, "x-search-results");
  const parsed = results === null ? NaN : Number(results);
  return {
    searchStatus: header(headers, "x-search-status") ?? bodyString("search_status"),
    searchReason: header(headers, "x-search-reason") ?? bodyString("search_reason"),
    searchResults: Number.isFinite(parsed) ? parsed : null,
    searchNotes: header(headers, "x-search-notes"),
    searchFallback: header(headers, "x-search-fallback"),
    quota,
  };
}

function errorMessage(tool: string, status: number, body: unknown): string {
  let detail = "";
  if (isObject(body)) {
    const candidate = body["detail"] ?? body["message"] ?? body["error"];
    if (typeof candidate === "string") detail = candidate;
    else if (candidate !== undefined) detail = JSON.stringify(candidate);
  } else if (typeof body === "string") {
    detail = body.slice(0, 300);
  }
  return `FlightPowers ${tool} answered HTTP ${status}${detail ? `: ${detail}` : ""}`;
}

function retryAfterMs(headers: Headers): number | null {
  const raw = headers.get("retry-after");
  if (raw === null) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds, 60) * 1000;
  return null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * The FlightPowers client.
 *
 * ```ts
 * const fp = new FlightPowers({ rapidApiKey: process.env.RAPIDAPI_KEY! });
 * const { data, meta } = await fp.flights.oneway({ from_airport: "JFK", to_airport: "LHR", departure_date: "2027-01-20" });
 * ```
 */
export class FlightPowers {
  readonly flights: Flights;
  readonly booking: Booking;
  readonly airbnb: Airbnb;
  readonly googleHotels: GoogleHotels;

  readonly #key: string;
  readonly #fetch: typeof fetch;
  readonly #maxRetries: number;
  readonly #retryDelayMs: number;
  readonly #timeoutMs: number;
  readonly #baseUrls: Record<Product, string>;

  constructor(options: FlightPowersOptions) {
    if (!options || typeof options.rapidApiKey !== "string" || options.rapidApiKey.trim() === "") {
      throw new TypeError("FlightPowers: rapidApiKey is required");
    }
    const fetchImpl = options.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch;
    if (typeof fetchImpl !== "function") {
      throw new TypeError("FlightPowers: no global fetch; pass options.fetch (Node 18+ has one)");
    }
    this.#key = options.rapidApiKey.trim();
    this.#fetch = fetchImpl;
    this.#maxRetries = Math.max(0, Math.floor(options.maxRetries ?? 0));
    this.#retryDelayMs = Math.max(0, options.retryDelayMs ?? 1000);
    this.#timeoutMs = Math.max(1, options.timeoutMs ?? 180_000);
    this.#baseUrls = {
      flights: options.baseUrls?.flights ?? `https://${HOSTS.flights}`,
      booking: options.baseUrls?.booking ?? `https://${HOSTS.booking}`,
      airbnb: options.baseUrls?.airbnb ?? `https://${HOSTS.airbnb}`,
      googleHotels: options.baseUrls?.googleHotels ?? `https://${HOSTS.googleHotels}`,
    };
    const call = this.#post.bind(this);
    this.flights = new Flights(call);
    this.booking = new Booking(call);
    this.airbnb = new Airbnb(call);
    this.googleHotels = new GoogleHotels(call);
  }

  /** Send one POST. Exposed for endpoints this version does not wrap yet. */
  request<T = unknown>(
    product: Product,
    path: string,
    params: object,
    tool: string,
    options?: RequestOptions,
  ): Promise<FlightPowersResponse<T>> {
    return this.#post<T>(product, path, params, tool, options);
  }

  async #post<T>(
    product: Product,
    path: string,
    params: object,
    tool: string,
    options: RequestOptions = {},
  ): Promise<FlightPowersResponse<T>> {
    if (!isObject(params)) throw new TypeError(`FlightPowers ${tool}: params must be an object`);
    const url = `${this.#baseUrls[product].replace(/\/+$/, "")}${path}`;
    const body = JSON.stringify({ ...params, _fp_source: SOURCE_TAG, _fp_tool: tool });
    const maxRetries = Math.max(0, Math.floor(options.maxRetries ?? this.#maxRetries));
    const timeoutMs = options.timeoutMs ?? this.#timeoutMs;

    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const onAbort = () => controller.abort(options.signal?.reason);
      if (options.signal?.aborted) throw options.signal.reason;
      options.signal?.addEventListener("abort", onAbort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);

      let response: Response;
      let text: string;
      try {
        response = await this.#fetch(url, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            accept: "application/json",
            "x-rapidapi-key": this.#key,
            "x-rapidapi-host": HOSTS[product],
          },
          body,
          signal: controller.signal,
        });
        text = await response.text();
      } catch (cause) {
        throw new FlightPowersError(
          `FlightPowers ${tool}: request failed (${cause instanceof Error ? cause.message : String(cause)})`,
          { status: 0, cause },
        );
      } finally {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      }

      let parsed: unknown = text;
      if (text !== "") {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      } else {
        parsed = null;
      }
      const meta = readMeta(response.headers, parsed);

      if (response.ok) {
        return { data: parsed as T, status: response.status, meta, headers: response.headers };
      }

      const error = new FlightPowersError(errorMessage(tool, response.status, parsed), {
        status: response.status,
        body: parsed,
        meta,
        headers: response.headers,
      });
      if (response.status === 503 && error.retry === true && attempt < maxRetries) {
        const wait = retryAfterMs(response.headers) ?? this.#retryDelayMs * 2 ** attempt;
        await sleep(wait, options.signal);
        continue;
      }
      throw error;
    }
  }
}

type Post = <T>(
  product: Product,
  path: string,
  params: object,
  tool: string,
  options?: RequestOptions,
) => Promise<FlightPowersResponse<T>>;

/** Google Flights Live API (https://rapidapi.com/mtnrabi/api/google-flights-live-api). */
export class Flights {
  constructor(private readonly post: Post) {}

  /** One-way itineraries for a route and date. */
  oneway(params: OnewayParams, options?: RequestOptions) {
    return this.post<OnewayFlight[]>("flights", "/api/google_flights/oneway/v1", params, "flights.oneway", options);
  }

  /** Round trips: both legs paired and priced together, one total per row. */
  roundtrip(params: RoundtripParams, options?: RequestOptions) {
    return this.post<RoundtripFlight[]>("flights", "/api/google_flights/roundtrip/v1", params, "flights.roundtrip", options);
  }

  /** One-way with 1 to 4 airports a side (at most 8 pairs), one billed request. */
  onewayMultiAirport(params: OnewayMultiAirportParams, options?: RequestOptions) {
    return this.post<OnewayFlight[]>(
      "flights", "/api/google_flights/oneway_multi_airport/v1", params, "flights.oneway_multi_airport", options,
    );
  }

  /** Round trip with 1 to 4 airports a side (at most 8 pairs), one billed request. */
  roundtripMultiAirport(params: RoundtripMultiAirportParams, options?: RequestOptions) {
    return this.post<RoundtripFlight[]>(
      "flights", "/api/google_flights/roundtrip_multi_airport/v1", params, "flights.roundtrip_multi_airport", options,
    );
  }
}

/** Booking Live API (https://rapidapi.com/mtnrabi/api/booking-live-api). */
export class Booking {
  constructor(private readonly post: Post) {}

  /** Hotels at a destination, with filters, a per-night budget and `proxy_country`. */
  search(params: BookingSearchParams, options?: RequestOptions) {
    return this.post<BookingSearchResult>("booking", "/search", params, "booking.search", options);
  }

  /** One hotel by name: availability and price for the stay. */
  hotelByName(params: HotelByNameParams, options?: RequestOptions) {
    return this.post<HotelByNameResult>("booking", "/hotel_by_name", params, "booking.hotel_by_name", options);
  }

  /** Turn a hotel name into the `hotel_booking_id` that `rooms` takes. */
  resolve(params: ResolveParams, options?: RequestOptions) {
    return this.post<ResolveResult>("booking", "/resolve", params, "booking.resolve", options);
  }

  /** Every bookable room type for one hotel, with prices and board. */
  rooms(params: RoomsParams, options?: RequestOptions) {
    return this.post<RoomsResult>("booking", "/hotel", params, "booking.rooms", options);
  }
}

/** Airbnb Live API (https://rapidapi.com/mtnrabi/api/airbnb-live-api). */
export class Airbnb {
  constructor(private readonly post: Post) {}

  /** Listings at a destination, with Airbnb's own filters. */
  search(params: AirbnbSearchParams, options?: RequestOptions) {
    return this.post<ProviderEnvelope<AirbnbProperty>>("airbnb", "/search", params, "airbnb.search", options);
  }

  /** One listing by its id. */
  details(params: AirbnbDetailsParams, options?: RequestOptions) {
    return this.post<ProviderEnvelope<AirbnbProperty>>("airbnb", "/details", params, "airbnb.details", options);
  }
}

/** Google Hotels Live API (https://rapidapi.com/mtnrabi/api/google-hotels-live-api). */
export class GoogleHotels {
  constructor(private readonly post: Post) {}

  /** One page of hotels at a destination. */
  search(params: GoogleHotelsSearchParams, options?: RequestOptions) {
    return this.post<ProviderEnvelope<GoogleHotelsProperty>>(
      "googleHotels", "/search", params, "google_hotels.search", options,
    );
  }

  /** One hotel's rate on each site Google lists for it. */
  rates(params: GoogleHotelsRatesParams, options?: RequestOptions) {
    return this.post<GoogleHotelsRatesResult>("googleHotels", "/rates", params, "google_hotels.rates", options);
  }
}
