"""The one exception this package raises for an API answer."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Dict, Optional

if TYPE_CHECKING:  # pragma: no cover
    from ._client import ResponseMeta

__all__ = ["FlightPowersError"]


class FlightPowersError(Exception):
    """Raised for any non-2xx answer, and for a request that got no answer (``status == 0``).

    Carries the HTTP status, the search headers and the parsed body, so you can
    tell a degraded search (retry it) from a bad request (fix it) from a spent
    quota (upgrade).
    """

    def __init__(
        self,
        message: str,
        *,
        status: int,
        body: Any = None,
        meta: "Optional[ResponseMeta]" = None,
        headers: Optional[Dict[str, str]] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        #: HTTP status code (0 when the request never got an answer).
        self.status = status
        #: Parsed JSON body, or the raw text when it was not JSON.
        self.body = body
        self.meta = meta
        self.headers = headers or {}
        #: ``X-Search-Status`` or the body's ``search_status``.
        self.search_status = meta.search_status if meta is not None else None
        #: ``X-Search-Reason`` or the body's ``search_reason``.
        self.search_reason = meta.search_reason if meta is not None else None
        flag = body.get("retry") if isinstance(body, dict) else None
        #: The API's own ``retry`` flag from the body, when it sent one.
        self.retry = flag if isinstance(flag, bool) else None

    def __repr__(self) -> str:
        return "FlightPowersError(status={!r}, search_status={!r}, message={!r})".format(
            self.status, self.search_status, self.message
        )
