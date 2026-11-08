// Compiled by `npm test` (tsc --noEmit) against the built declarations.
import type { BookingFilter, BookingSearchParams } from "../dist/esm/index.js";
import { BOOKING_FILTERS } from "../dist/esm/index.js";

const real: BookingFilter = "accepts_online_payment";
// @ts-expect-error the old misspelling is not a filter
const wrong: BookingFilter = "accepts_online_pay";
const params: BookingSearchParams = {
  destination: "Paris",
  checkin_date: "2027-01-20",
  checkout_date: "2027-01-23",
  filters: [...BOOKING_FILTERS],
};
export { real, wrong, params };
