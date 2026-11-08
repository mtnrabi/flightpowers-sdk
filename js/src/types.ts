/**
 * Request and response shapes, taken from the FlightPowers docs
 * (https://flightpowers.com/docs and https://flightpowers.com/llms-full.txt).
 *
 * Result types list the documented fields and stay open (`[key: string]: unknown`)
 * so a field the API adds later still reaches you.
 */

/* ------------------------------------------------------------------ shared */

/** How a search went, from the `X-Search-Status` header (or the body envelope). */
export type SearchStatus = "ok" | "empty" | "partial" | "degraded" | "error" | (string & {});

/** One integer per passenger: 1 adult, 2 child, 3 infant on lap, 4 infant in seat. */
export type PassengerCode = 1 | 2 | 3 | 4;

/** Cabin: 1 economy, 2 premium economy, 3 business, 4 first. */
export type SeatType = 1 | 2 | 3 | 4;

export type FlightSort = "Overall" | "Price" | "Duration";

/** Search metadata read from the response headers. */
export interface ResponseMeta {
  /** `X-Search-Status`, or `search_status` from a body envelope when the header is absent. */
  searchStatus: SearchStatus | null;
  /** `X-Search-Reason`, or `search_reason` from a body envelope. */
  searchReason: string | null;
  /** `X-Search-Results` as a number. */
  searchResults: number | null;
  /** `X-Search-Notes` (e.g. `via_rpc`). */
  searchNotes: string | null;
  /** `X-Search-Fallback` (e.g. `used`). */
  searchFallback: string | null;
  /** RapidAPI quota headers (`x-ratelimit-*`, `x-plan-*`), names lower-cased. */
  quota: Record<string, string>;
}

/** What every SDK method resolves to. */
export interface FlightPowersResponse<T> {
  /** The parsed JSON body. */
  data: T;
  /** HTTP status code. */
  status: number;
  meta: ResponseMeta;
  /** All response headers. */
  headers: Headers;
}

/* ----------------------------------------------------------------- flights */

interface FlightCommonParams {
  sort_type?: FlightSort;
  /** ISO currency code, default `USD`. */
  currency?: string;
  max_price?: number;
  seat_type?: SeatType;
  passengers?: PassengerCode[];
  /** Maximum number of results, default 10. */
  limit?: number;
  /** Set `false` to switch off the last-resort fallback source. */
  use_fallback?: boolean;
  /** `true` turns a degraded search into HTTP 503 instead of an empty array. */
  strict?: boolean;
  /** `false` forces a direct request (lower latency, more block risk). */
  use_ext_proxy?: boolean;
}

export interface OnewayParams extends FlightCommonParams {
  /** Origin IATA code, e.g. `JFK`. */
  from_airport: string;
  /** Destination IATA code, e.g. `LHR`. */
  to_airport: string;
  /** `YYYY-MM-DD`. */
  departure_date: string;
  max_stops?: number;
  airline_codes?: string[];
  exclude_airline_codes?: string[];
  departure_time_min?: number;
  departure_time_max?: number;
  departure_arrival_time_min?: number;
  departure_arrival_time_max?: number;
}

export interface RoundtripParams extends FlightCommonParams {
  from_airport: string;
  to_airport: string;
  departure_date: string;
  return_date: string;
  max_departure_stops?: number;
  max_return_stops?: number;
  departure_airline_codes?: string[];
  return_airline_codes?: string[];
  departure_exclude_airline_codes?: string[];
  return_exclude_airline_codes?: string[];
  departure_departure_time_min?: number;
  departure_departure_time_max?: number;
  departure_arrival_time_min?: number;
  departure_arrival_time_max?: number;
  return_departure_time_min?: number;
  return_departure_time_max?: number;
  return_arrival_time_min?: number;
  return_arrival_time_max?: number;
  /** Return flights paired with each outbound flight, 1 to 5 (default 2). */
  returns_per_outbound?: number;
}

/** 1 to 4 IATA codes, as a list or a comma-separated string (`"TLV,ATH"`). */
export type AirportList = string[] | string;

export interface OnewayMultiAirportParams extends Omit<OnewayParams, "from_airport" | "to_airport" | "use_fallback"> {
  from_airport: AirportList;
  to_airport: AirportList;
  /** Must be `false` or absent on the multi-airport endpoints. */
  use_fallback?: false;
}

export interface RoundtripMultiAirportParams extends Omit<RoundtripParams, "from_airport" | "to_airport" | "use_fallback"> {
  from_airport: AirportList;
  to_airport: AirportList;
  use_fallback?: false;
}

export interface StopInfo {
  stop_airport?: string;
  stop_duration_seconds?: number;
  [key: string]: unknown;
}

export interface OnewayFlight {
  /** Google's verdict vs the route's historical range, when Google shows one. */
  price_range_in_relation_to_other_periods?: "low" | "typical" | "high" | null;
  price_insights_low?: number | null;
  price_insights_high?: number | null;
  from_airport?: string;
  to_airport?: string;
  departure_date?: string;
  /** Display price, e.g. `$433`. */
  price?: string;
  price_as_number?: number;
  duration?: string;
  duration_seconds?: number;
  /** Deep link to this itinerary on Google Flights. */
  buy_link?: string;
  airline?: string;
  stops?: number;
  stops_info?: StopInfo[];
  departure_description?: string;
  arrival_description?: string;
  [key: string]: unknown;
}

export interface RoundtripFlight {
  price_range_in_relation_to_other_periods?: "low" | "typical" | "high" | null;
  price_insights_low?: number | null;
  price_insights_high?: number | null;
  from_airport?: string;
  to_airport?: string;
  departure_date?: string;
  return_date?: string;
  total_price?: string;
  total_price_as_number?: number;
  total_duration_seconds?: number;
  total_stops?: number;
  buy_link?: string;
  departure_flight_departure_description?: string;
  departure_flight_arrival_description?: string;
  departure_flight_airline?: string;
  departure_flight_stops?: number;
  departure_flight_duration?: string;
  return_flight_departure_description?: string;
  return_flight_arrival_description?: string;
  return_flight_airline?: string;
  return_flight_stops?: number;
  return_flight_duration?: string;
  [key: string]: unknown;
}

/* ----------------------------------------------------------------- booking */

export type BookingFilter =
  | "free_cancellation" | "breakfast_included" | "breakfast_and_lunch" | "breakfast_and_dinner"
  | "all_meals_included" | "all_inclusive" | "free_wifi" | "swimming_pool" | "gym" | "parking"
  | "front_desk_24h" | "review_score_7" | "review_score_8" | "review_score_9" | "private_bathroom"
  | "air_conditioning" | "stars_3" | "stars_4" | "stars_5" | "pets_allowed" | "adults_only"
  | "sauna" | "very_good_breakfast" | "accepts_online_pay";

export type HotelSort = "price_asc" | "price_desc" | "rating_desc";

interface StayParams {
  /** `YYYY-MM-DD`. */
  checkin_date: string;
  /** `YYYY-MM-DD`. */
  checkout_date: string;
  /** Default 2. */
  adults?: number;
  /** Default 0. */
  children?: number;
  /** Default `USD`. */
  currency?: string;
  /** Two-letter country code: price the stay as seen from that market. */
  proxy_country?: string;
}

export interface BookingSearchParams extends StayParams {
  /** Free-text destination, e.g. `Paris`. The field is `destination`, not `location`. */
  destination: string;
  budget_per_night?: number;
  filters?: BookingFilter[];
  sort?: HotelSort | "price" | "rating";
}

export interface BookingProperty {
  name?: string;
  /** Display price for the whole stay, e.g. `US$2,434`. */
  price_string?: string;
  price?: number | null;
  review_score?: number | null;
  review_count?: number | null;
  room_type?: string;
  location?: string;
  image_url?: string;
  /** Deep link to the property on Booking.com with dates and occupancy filled in. */
  link?: string;
  latitude?: number | null;
  longitude?: number | null;
  [key: string]: unknown;
}

export interface BookingSearchResult {
  destination?: string;
  checkin_date?: string;
  checkout_date?: string;
  applied_filters?: string[];
  budget_per_night?: number | null;
  properties: BookingProperty[];
  [key: string]: unknown;
}

export interface HotelByNameParams extends StayParams {
  /** Free-text hotel name, e.g. `Kremlin Palace`. */
  hotel_name: string;
  /** City or region to tell generic names apart, e.g. `Budapest`. */
  area?: string;
  free_cancellation?: boolean;
}

export interface HotelByNameResult {
  name?: string;
  /** `false` means no rooms for those dates. */
  available?: boolean;
  price_string?: string;
  price?: number | null;
  review_score?: number | null;
  review_count?: number | null;
  room_type?: string;
  image_url?: string;
  link?: string;
  nights?: number;
  adults?: number;
  children?: number;
  latitude?: number | null;
  longitude?: number | null;
  [key: string]: unknown;
}

export interface ResolveParams {
  hotel_name: string;
  proxy_country?: string;
}

export interface ResolveResult {
  hotel_name?: string;
  /** Pass this to `booking.rooms`. */
  hotel_booking_id?: string;
  matched_name?: string;
  [key: string]: unknown;
}

export interface RoomsParams extends StayParams {
  /** Booking.com hotel path id, e.g. `cy/four-seasons-limassol`, from `booking.resolve`. */
  hotel_booking_id: string;
  free_cancellation?: boolean;
}

export interface Room {
  room_type?: string;
  /** Board line, e.g. `Exceptional breakfast included`. */
  room_economy?: string;
  guests?: number;
  price?: string;
  price_as_number?: number | null;
  [key: string]: unknown;
}

export interface RoomsResult {
  hotel_booking_id?: string;
  checkin_date?: string;
  checkout_date?: string;
  booking_url?: string;
  rooms: Room[];
  [key: string]: unknown;
}

/* ------------------------------------------------------- airbnb + g-hotels */

/** The envelope the Airbnb and Google Hotels APIs answer with. */
export interface ProviderEnvelope<P> {
  provider?: string;
  search_status: SearchStatus;
  search_reason?: string;
  properties: P[];
  /** Per filter: applied by the provider, or after the page arrived (`post_filter: true`). */
  filters_applied?: Record<string, unknown>;
  detail?: string;
  [key: string]: unknown;
}

export type AirbnbRoomType = "Entire home/apt" | "Private room" | "Shared room" | "Hotel room";

export interface AirbnbSearchParams {
  destination: string;
  checkin_date: string;
  checkout_date: string;
  adults?: number;
  children?: number;
  infants?: number;
  pets?: number;
  currency?: string;
  price_min?: number;
  price_max?: number;
  min_bedrooms?: number;
  min_beds?: number;
  min_bathrooms?: number;
  room_types?: AirbnbRoomType[];
  min_rating?: number;
  sort?: HotelSort;
  proxy_country?: string;
}

export interface AirbnbProperty {
  name?: string;
  provider_property_id?: string;
  price_total?: number | null;
  price_per_night?: number | null;
  price_original_total?: number | null;
  currency?: string;
  price_string?: string;
  rating?: number | null;
  rating_scale?: number;
  latitude?: number | null;
  longitude?: number | null;
  link?: string;
  image_url?: string;
  nights?: number;
  retrieved_at?: string;
  [key: string]: unknown;
}

export interface AirbnbDetailsParams {
  /** Airbnb's numeric room id (a search row's `provider_property_id`). */
  listing_id: string;
  checkin_date?: string;
  checkout_date?: string;
  adults?: number;
  currency?: string;
  proxy_country?: string;
}

export interface GoogleHotelsSearchParams {
  destination: string;
  checkin_date: string;
  checkout_date: string;
  /** 1 to 9. */
  adults?: number;
  /** One age (0-17) per child. */
  children_ages?: number[];
  currency?: string;
}

export interface GoogleHotelsRatesParams {
  /** Name lookup (add `destination` to narrow it), or pass `entity_id` instead. */
  hotel_name?: string;
  destination?: string;
  /** A Google Hotels id, e.g. a search row's `provider_property_id`. */
  entity_id?: string;
  checkin_date: string;
  checkout_date: string;
  adults?: number;
  children_ages?: number[];
  currency?: string;
}

export interface GoogleHotelsSite {
  /** The site's name, e.g. `Booking.com`. */
  site?: string;
  site_id?: number | null;
  currency?: string;
  price_total?: number | null;
  price_total_before_taxes?: number | null;
  price_per_night?: number | null;
  price_string?: string;
  per_night_string?: string;
  taxes_included?: boolean | null;
  official_site?: boolean;
  link?: string;
  [key: string]: unknown;
}

export interface GoogleHotelsProperty {
  name?: string;
  provider_property_id?: string;
  price_total?: number | null;
  price_per_night?: number | null;
  currency?: string;
  rating?: number | null;
  latitude?: number | null;
  longitude?: number | null;
  link?: string;
  /** Present on `googleHotels.rates` rows. */
  sites?: GoogleHotelsSite[];
  [key: string]: unknown;
}

export interface GoogleHotelsRatesResult extends ProviderEnvelope<GoogleHotelsProperty> {
  matched_name?: string;
  match_score?: number;
  /** When the name matched a different hotel: pick one and call again with its `entity_id`. */
  candidates?: Array<{ name?: string; entity_id?: string; [key: string]: unknown }>;
}
