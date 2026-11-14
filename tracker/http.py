"""A small HTTP GET helper that retries when a server is busy."""
from __future__ import annotations

import time

import requests

USER_AGENT = "data-tracker-class-project/1.0"
RETRY_STATUS = {429, 500, 502, 503, 504}


class SourceError(Exception):
    """Raised when a source cannot be downloaded or understood."""


def get(url, *, headers=None, params=None, timeout=30, retries=3, backoff=3.0,
        session=None, sleep=time.sleep):
    """GET a URL and return the response.

    Busy-server answers (429 and 5xx) and network errors are retried, waiting
    a little longer each time. Any other error status raises at once.
    """
    client = session or requests
    merged = {"User-Agent": USER_AGENT}
    merged.update(headers or {})
    last = "no attempt made"
    for attempt in range(retries + 1):
        try:
            response = client.get(url, headers=merged, params=params, timeout=timeout)
        except requests.RequestException as exc:
            last = type(exc).__name__
        else:
            if response.status_code < 400:
                return response
            last = "HTTP %s" % response.status_code
            if response.status_code not in RETRY_STATUS:
                raise SourceError(last)
        if attempt < retries:
            sleep(backoff * (attempt + 1))
    raise SourceError("%s after %d attempts" % (last, retries + 1))
