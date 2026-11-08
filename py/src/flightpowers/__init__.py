"""Official FlightPowers client: live Google Flights, Booking.com, Airbnb and Google Hotels data.

>>> from flightpowers import FlightPowers
>>> fp = FlightPowers(rapidapi_key="...")
>>> res = fp.flights.oneway(from_airport="JFK", to_airport="LHR", departure_date="2027-01-20")
"""

from ._client import HOSTS, SOURCE_TAG, VERSION, FlightPowers, Response, ResponseMeta
from ._errors import FlightPowersError

__version__ = VERSION

__all__ = [
    "FlightPowers",
    "FlightPowersError",
    "Response",
    "ResponseMeta",
    "HOSTS",
    "SOURCE_TAG",
    "VERSION",
    "__version__",
]
