"""The only code that sets or deletes the auth cookies, with their flags.

Three cookies carry JWTs:

``jwt``
    The access token, for the requests a browser cannot put a header on
    (``<img>``, ``<video>``, download links). Only the server reads it, through
    ``JWTCookieAuthentication`` (api/accounts/authentication.py), so it is ``HttpOnly``:
    a script injected into the page cannot read it. Set by the password login,
    the refresh and the SSO bridge; cleared by the logout view, because the web
    cannot delete an ``HttpOnly`` cookie itself.

``access`` and ``refresh``
    The tokens the web sends as ``Authorization: Bearer``. The web writes and
    reads them itself (apps/frontend/src/api_client/authCookies.ts); the
    server sets them only in the SSO bridge, which ends in a redirect and has
    no JSON body to return them in. They are not ``HttpOnly`` while the web
    keeps its bearer tokens in script-readable cookies.

Every one of them is ``SameSite=Lax`` and lives at ``/``. Lax still sends the
cookie on top-level navigations and on same-site ``<img>``/``<video>``
requests, which is all the media views need, and keeps it off cross-site
subrequests and cross-site POSTs. Ports do not make a site, so the split-origin
dev setup (web on ``localhost:3000``, backend on ``localhost:8001``) is
same-site too.

``Secure`` is set when the request came in over HTTPS or ``AUTH_COOKIE_SECURE``
is on. ``SECURE_PROXY_SSL_HEADER`` is not set, and the bundled proxy forwards
its own scheme, which is ``http`` when TLS ends at a proxy in front of it, so
behind a TLS proxy the request looks like plain HTTP and the setting is the
switch. It is off by default: a browser refuses a ``Secure`` cookie over plain
HTTP, and most installs are reached that way on the LAN.

The CORS headers (``Access-Control-Allow-Credentials`` included) are
django-cors-headers' job, for the origins in ``CORS_ALLOWED_ORIGINS``.
"""

from typing import Final, Literal

from django.conf import settings
from django.http import HttpRequest, HttpResponseBase
from rest_framework.request import Request

from api.accounts.authentication import JWT_COOKIE_NAME

ACCESS_COOKIE_NAME = "access"
REFRESH_COOKIE_NAME = "refresh"

COOKIE_PATH = "/"
COOKIE_SAMESITE: Final[Literal["Lax"]] = "Lax"
# What Django's delete_cookie sends: a date long past expires the cookie in
# browsers that ignore Max-Age=0.
_EXPIRED = "Thu, 01 Jan 1970 00:00:00 GMT"


def cookie_secure(request: HttpRequest | Request) -> bool:
    """Whether the auth cookies get the ``Secure`` flag on this response."""
    return request.is_secure() or bool(settings.AUTH_COOKIE_SECURE)


def _set(
    response: HttpResponseBase,
    request: HttpRequest | Request,
    name: str,
    value: str,
    *,
    httponly: bool,
) -> None:
    response.set_cookie(
        name,
        value,
        path=COOKIE_PATH,
        samesite=COOKIE_SAMESITE,
        secure=cookie_secure(request),
        httponly=httponly,
    )


def set_auth_cookies(
    response: HttpResponseBase,
    request: HttpRequest | Request,
    *,
    access: str,
    refresh: str | None = None,
) -> None:
    """Set the ``jwt`` cookie to ``access`` on ``response``.

    With ``refresh`` (the SSO bridge), also hand the web its ``access`` and
    ``refresh`` cookies to boot from. The password login and the refresh
    return those two in the JSON body instead.
    """
    _set(response, request, JWT_COOKIE_NAME, access, httponly=True)
    if refresh is not None:
        _set(response, request, ACCESS_COOKIE_NAME, access, httponly=False)
        _set(response, request, REFRESH_COOKIE_NAME, refresh, httponly=False)


def clear_auth_cookies(
    response: HttpResponseBase, request: HttpRequest | Request
) -> None:
    """Expire every auth cookie at ``/``, with the flags it was set with.

    ``access`` and ``refresh`` too: the web removes its own copies as well, but
    clearing them here also covers a client that does not.
    """
    for name, httponly in (
        (JWT_COOKIE_NAME, True),
        (ACCESS_COOKIE_NAME, False),
        (REFRESH_COOKIE_NAME, False),
    ):
        response.set_cookie(
            name,
            "",
            max_age=0,
            expires=_EXPIRED,
            path=COOKIE_PATH,
            samesite=COOKIE_SAMESITE,
            secure=cookie_secure(request),
            httponly=httponly,
        )
