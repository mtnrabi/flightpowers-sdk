import type { ResponseMeta, SearchStatus } from "./types.js";

/**
 * Thrown for any non-2xx answer. Carries the HTTP status, the search headers
 * and the parsed body, so you can tell a degraded search (retry it) from a bad
 * request (fix it) from a spent quota (upgrade).
 */
export class FlightPowersError extends Error {
  /** HTTP status code (0 when the request never got an answer). */
  readonly status: number;
  /** `X-Search-Status` or the body's `search_status`. */
  readonly searchStatus: SearchStatus | null;
  /** `X-Search-Reason` or the body's `search_reason`. */
  readonly searchReason: string | null;
  /** The API's own `retry` flag from the body, when it sent one. */
  readonly retry: boolean | null;
  /** Parsed JSON body, or the raw text when it was not JSON. */
  readonly body: unknown;
  readonly meta: ResponseMeta | null;
  readonly headers: Headers | null;

  constructor(
    message: string,
    init: {
      status: number;
      body?: unknown;
      meta?: ResponseMeta | null;
      headers?: Headers | null;
      cause?: unknown;
    },
  ) {
    super(message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "FlightPowersError";
    this.status = init.status;
    this.body = init.body;
    this.meta = init.meta ?? null;
    this.headers = init.headers ?? null;
    this.searchStatus = init.meta?.searchStatus ?? null;
    this.searchReason = init.meta?.searchReason ?? null;
    const flag = isObject(init.body) ? init.body["retry"] : undefined;
    this.retry = typeof flag === "boolean" ? flag : null;
  }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
