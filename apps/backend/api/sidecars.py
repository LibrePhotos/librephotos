"""Where the sidecars listen, and the one HTTP client the backend calls them with.

Addresses
    ``SERVICES`` is the only place a sidecar's port is written down: the
    backend builds its URLs from it (``sidecar_url``), api.services starts and
    watches the processes it lists, and the sidecars bind to it
    (service._common.serve). The sidecars listen on IPv4 loopback only
    (127.0.0.1 unless SERVICE_HOST says otherwise). ``localhost`` resolves to
    ``::1`` first, and Windows retries a refused connection for about two
    seconds before it falls back to 127.0.0.1, so every sidecar request on a
    native Windows install took two seconds longer than the work it asked for -
    several times per photo during a scan.

Calls
    ``post`` and ``get`` send through one pooled session that retries what a
    busy or restarting sidecar can transiently do - refuse or drop the
    connection, or answer 503 - and raise ``requests.HTTPError`` for any other
    error status, so no caller reads the body of a failed reply as if it were
    an answer. A read that timed out is not retried: a sidecar serves one
    request at a time and is most likely still working on the first, so a
    retry would only queue the same work behind it. Each caller turns the
    exceptions into its own error (MetadataReadError, CaptionError, ...).

This module must stay importable without Django: the sidecars read their port
from it.
"""

import os

import requests
from requests.adapters import HTTPAdapter
from urllib3.exceptions import ReadTimeoutError
from urllib3.util.retry import Retry

SIDECAR_HOST = "http://127.0.0.1"

SERVICES = {
    "image_similarity": 8002,
    "thumbnail": 8003,
    "face_recognition": 8005,
    "clip_embeddings": 8006,
    "image_captioning": 8007,
    "exif": 8010,
    "tags": 8011,
    "ocr": 8012,
}

# Three attempts in all, about a second apart at most: long enough to ride
# out a sidecar the watchdog is restarting, short enough that a dead one fails
# the photo instead of the scan.
MAX_RETRIES = 2
RETRY_BACKOFF = 0.5
RETRY_STATUSES = (503,)


def sidecar_url(service, path=""):
    """The URL of *path* on the sidecar named *service* (a key of SERVICES)."""
    try:
        port = SERVICES[service]
    except KeyError:
        raise ValueError(f"unknown sidecar {service!r}") from None
    return f"{SIDECAR_HOST}:{port}{path}"


class _SidecarRetry(Retry):
    """Retry connection failures and 503s, never a read that timed out."""

    def increment(self, method=None, url=None, response=None, error=None, **kwargs):
        if isinstance(error, ReadTimeoutError):
            # Raised as-is, requests reports it as ReadTimeout, as it would
            # without a retry policy.
            raise error
        return super().increment(
            method=method, url=url, response=response, error=error, **kwargs
        )


def _retry_policy():
    return _SidecarRetry(
        total=MAX_RETRIES,
        connect=MAX_RETRIES,
        read=MAX_RETRIES,
        status=MAX_RETRIES,
        other=0,
        redirect=0,
        backoff_factor=RETRY_BACKOFF,
        status_forcelist=RETRY_STATUSES,
        # Every sidecar call is safe to repeat, POSTs included: they read a
        # file and compute an answer, or (thumbnail) rewrite the same file.
        allowed_methods=None,
        # Hand back the last 503 so raise_for_status reports it with its body.
        raise_on_status=False,
        respect_retry_after_header=False,
    )


class _Client:
    """A requests session per process.

    The django-q cluster forks its workers after importing the task modules;
    a pooled connection inherited across fork would be shared by two
    processes, so a child builds its own session.
    """

    def __init__(self):
        self._session = None
        self._pid = None

    def session(self):
        if self._session is None or self._pid != os.getpid():
            session = requests.Session()
            adapter = HTTPAdapter(max_retries=_retry_policy())
            session.mount("http://", adapter)
            self._session = session
            self._pid = os.getpid()
        return self._session

    def request(self, method, url, **kwargs):
        return self.session().request(method, url, **kwargs)

    def get(self, url, **kwargs):
        return self.request("GET", url, **kwargs)

    def post(self, url, **kwargs):
        return self.request("POST", url, **kwargs)

    def delete(self, url, **kwargs):
        return self.request("DELETE", url, **kwargs)


http = _Client()


def _checked(response):
    response.raise_for_status()
    return response


def post(service, path, *, json, timeout):
    """POST *json* to a sidecar; the response, or HTTPError for an error status."""
    return _checked(http.post(sidecar_url(service, path), json=json, timeout=timeout))


def get(service, path, *, timeout):
    """GET from a sidecar; the response, or HTTPError for an error status."""
    return _checked(http.get(sidecar_url(service, path), timeout=timeout))


def error_detail(error):
    """The sidecar's own reason for a failed call, else the error itself.

    The sidecars answer a failure with ``{"error": "..."}``; that message is
    the only place the cause is visible without the sidecar's stdout.
    """
    response = getattr(error, "response", None)
    if response is not None:
        try:
            body = response.json()
            if isinstance(body, dict) and body.get("error"):
                return str(body["error"])
        except ValueError:
            pass
    return str(error)
