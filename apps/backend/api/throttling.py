"""Rate limits for the endpoints that accept credentials without a session.

The rates are the ``auth`` and ``token_refresh`` scopes of
``REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]`` (``AUTH_THROTTLE_RATE`` and
``TOKEN_REFRESH_THROTTLE_RATE``). Counters live in Django's default cache.
Without a ``CACHES`` setting that is a local-memory cache per process, so each
of the ``WEB_CONCURRENCY`` uvicorn workers counts on its own (a client can make
up to rate x workers attempts) and a restart starts every counter again.

The client is DRF's ``get_ident()``: with ``NUM_PROXIES`` set, the address the
nearest trusted proxy appended to ``X-Forwarded-For``, otherwise the TCP peer.
The bundled proxy appends it (``deploy/docker/proxy/nginx.conf``); without
that, every client would share the proxy's address and one bucket.
"""

import hashlib
from collections.abc import Mapping

from django.contrib.auth import get_user_model
from rest_framework.request import Request
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView


class AuthRateThrottle(SimpleRateThrottle):
    """The ``auth`` scope, counted per client address."""

    scope = "auth"

    def get_cache_key(self, request: Request, view: APIView) -> str | None:
        return self.cache_format % {
            "scope": self.scope,
            "ident": self.get_ident(request),
        }


class SignInRateThrottle(AuthRateThrottle):
    """The ``auth`` scope, counted per client address and username.

    Keyed on the username as well, clients that share an address (a household
    behind one router, or everyone if a proxy in front does not pass the client
    address on) only use up each other's attempts at the same account, and a
    flood of guesses at one account does not lock everyone else out.
    """

    def get_cache_key(self, request: Request, view: APIView) -> str | None:
        data = request.data
        username = ""
        if isinstance(data, Mapping):
            username = str(data.get(get_user_model().USERNAME_FIELD) or "")
        # allauth's backend matches usernames case-insensitively, so "Admin"
        # and "admin" are the same account and share a counter. Hashed so the
        # key stays short and free of characters a shared cache rejects.
        account = hashlib.sha256(username.strip().casefold().encode()).hexdigest()
        return self.cache_format % {
            "scope": self.scope,
            "ident": f"{self.get_ident(request)}:{account[:32]}",
        }


class TokenRefreshRateThrottle(SimpleRateThrottle):
    """The ``token_refresh`` scope, counted per client address.

    Its own, higher rate: every open tab refreshes its access token every few
    minutes, and a refused refresh signs the web client out.
    """

    scope = "token_refresh"

    def get_cache_key(self, request: Request, view: APIView) -> str | None:
        return self.cache_format % {
            "scope": self.scope,
            "ident": self.get_ident(request),
        }
