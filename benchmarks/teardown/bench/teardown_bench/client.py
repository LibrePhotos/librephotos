"""A tiny JSON-over-HTTP client (standard library only).

Named client.py, not http.py, so it can never shadow the standard library's http package."""

from __future__ import annotations

import json
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from http.cookiejar import CookieJar
from typing import Any

# The apps run on localhost with self-signed certificates at most.
_INSECURE = ssl.create_default_context()
_INSECURE.check_hostname = False
_INSECURE.verify_mode = ssl.CERT_NONE


class HttpError(Exception):
    def __init__(self, method: str, url: str, status: int, body: str) -> None:
        super().__init__(f"{method} {url} -> {status}: {body[:300]}")
        self.status = status
        self.body = body


class Client:
    """JSON client with a bearer token, a cookie jar and a re-login hook.

    ``relogin`` is called once when a request answers 401 (LibrePhotos' access
    token lives five minutes), then the request is retried.
    """

    def __init__(self, base_url: str, timeout: float = 60) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.headers: dict[str, str] = {}
        self.relogin: Callable[[], None] | None = None
        self.requests = 0
        self._opener = urllib.request.build_opener(
            urllib.request.HTTPCookieProcessor(CookieJar()),
            urllib.request.HTTPSHandler(context=_INSECURE),
        )

    def url(self, path: str, query: dict[str, Any] | None = None) -> str:
        url = path if path.startswith("http") else f"{self.base_url}{path}"
        if query:
            url += ("&" if "?" in url else "?") + urllib.parse.urlencode(query)
        return url

    def raw(self, method: str, path: str, body: Any = None, query: dict[str, Any] | None = None,
            headers: dict[str, str] | None = None, retry_auth: bool = True) -> tuple[int, bytes, dict]:
        data = None
        all_headers = {"Accept": "application/json", **self.headers, **(headers or {})}
        if body is not None:
            data = json.dumps(body).encode()
            all_headers["Content-Type"] = "application/json"
        request = urllib.request.Request(self.url(path, query), data=data, method=method, headers=all_headers)
        self.requests += 1
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                return response.status, response.read(), dict(response.headers)
        except urllib.error.HTTPError as error:
            payload = error.read()
            if error.code == 401 and retry_auth and self.relogin is not None:
                self.relogin()
                return self.raw(method, path, body, query, headers, retry_auth=False)
            raise HttpError(method, request.full_url, error.code, payload.decode("utf-8", "replace")) from None

    def json(self, method: str, path: str, body: Any = None, query: dict[str, Any] | None = None,
             headers: dict[str, str] | None = None) -> Any:
        _status, payload, _headers = self.raw(method, path, body, query, headers)
        if not payload:
            return None
        try:
            return json.loads(payload)
        except ValueError:
            return payload.decode("utf-8", "replace")

    def get(self, path: str, **query: Any) -> Any:
        return self.json("GET", path, query=query or None)

    def post(self, path: str, body: Any = None) -> Any:
        return self.json("POST", path, body)

    def wait_until(self, check: Callable[[], bool], deadline: float, every: float = 3.0) -> bool:
        while time.monotonic() < deadline:
            try:
                if check():
                    return True
            except (HttpError, OSError, ValueError):
                pass
            time.sleep(every)
        return False
