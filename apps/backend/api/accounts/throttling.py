"""Rate limits for the endpoints that accept credentials without a session.

The rates are the ``auth`` and ``token_refresh`` scopes of
``REST_FRAMEWORK["DEFAULT_THROTTLE_RATES"]`` (``AUTH_THROTTLE_RATE`` and
``TOKEN_REFRESH_THROTTLE_RATE``). Counters live in Django's default cache.
Without a ``CACHES`` setting that is a local-memory cache per process, so each
of the ``WEB_CONCURRENCY`` uvicorn workers counts on its own (a client can make
up to rate x workers attempts) and a restart starts every counter again.

``BasicAuthFailureThrottle`` is not a view throttle: the Basic authentication
class asks it before every password check and records each failed one, so a
script that authenticates every request with Basic is never slowed down.

The client is DRF's ``get_ident()``: with ``NUM_PROXIES`` set, the address the
nearest trusted proxy appended to ``X-Forwarded-For``, otherwise the TCP peer.
The bundled proxy appends it (``deploy/docker/proxy/nginx.conf``); without
that, every client would share the proxy's address and one bucket.
"""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from typing import TYPE_CHECKING

from django.contrib.auth import get_user_model
from rest_framework.request import Request
from rest_framework.throttling import SimpleRateThrottle, UserRateThrottle

if TYPE_CHECKING:
    # Only for annotations: DRF imports the authentication classes, which use
    # this module, while it is still importing rest_framework.views.
    from rest_framework.views import APIView


def account_ident(throttle: SimpleRateThrottle, request: Request, username: str) -> str:
    """The client address plus a digest of ``username``, for a throttle's cache key.

    allauth's backend matches usernames case-insensitively, so "Admin" and
    "admin" are the same account and share a counter. Hashed so the key stays
    short and free of characters a shared cache rejects.
    """
    account = hashlib.sha256(username.strip().casefold().encode()).hexdigest()
    return f"{throttle.get_ident(request)}:{account[:32]}"


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
        return self.cache_format % {
            "scope": self.scope,
            "ident": account_ident(self, request, username),
        }


class BasicAuthFailureThrottle(SimpleRateThrottle):
    """Failed ``Authorization: Basic`` password checks, in sign-in's counter.

    Same scope and cache key as ``SignInRateThrottle`` (client address and
    username), so guesses through the token endpoint and through Basic
    credentials on any view come out of one budget per account. Only failures
    are recorded; once the budget is spent, ``locked`` refuses the right
    password too, or the guess that hits would still give itself away.
    """

    scope = "auth"

    def __init__(self, request: Request, username: str) -> None:
        super().__init__()
        self.key = self.cache_format % {
            "scope": self.scope,
            "ident": account_ident(self, request, username),
        }

    def get_cache_key(self, request: Request, view: APIView) -> str | None:
        return self.key

    def locked(self) -> bool:
        """True when the failures in the current window used up the rate."""
        num_requests, duration = self.parse_rate(self.rate)
        if num_requests is None or duration is None:
            return False
        # SimpleRateThrottle.allow_request without recording the request.
        self.history = self.cache.get(self.key, [])
        self.now = self.timer()
        while self.history and self.history[-1] <= self.now - duration:
            self.history.pop()
        return len(self.history) >= num_requests

    def record_failure(self) -> None:
        """Count one failed password check; call ``locked`` first."""
        if self.rate is not None:
            self.throttle_success()


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


class AlbumCommentRateThrottle(UserRateThrottle):
    """Writing comments and hearts in shared albums (#262), per signed-in user.

    Not a credential throttle: it keeps one member from flooding an album's
    threads. A fixed rate, so it needs no setting.
    """

    scope = "album_comment"
    rate = "30/minute"


class PublicGalleryRateThrottle(UserRateThrottle):
    """The public gallery's answers (#434): the ``public_gallery`` scope
    (``PUBLIC_GALLERY_THROTTLE_RATE``), per signed-in user and, for visitors
    without an account, per client address.

    Not a credential throttle: it keeps one client from walking the whole
    gallery's API in a loop. A visitor scrolling the timeline asks for a page
    of photos per day on screen, so the rate stays well above that.
    """

    scope = "public_gallery"
