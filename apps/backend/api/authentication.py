"""JWT authentication that also reads the ``jwt`` cookie.

The web app calls the API with ``Authorization: Bearer``, but a browser cannot
put a header on an ``<img>``, a ``<video>`` or a download link. For those the
token endpoints (``CustomTokenObtainPairView``, ``CustomTokenRefreshView``, the
SSO bridge) also set the access token as a cookie named ``jwt``, and the views
that serve such requests read it. The mobile client sends the same cookie on
uploads when it cannot rely on the header.

The cookie is ambient: the browser attaches it to requests another site
triggers, too. That is why this class is not in
``DEFAULT_AUTHENTICATION_CLASSES`` and is only named by the views that need it
(media serving, which is read-only, and the chunked upload, which predates the
header and is ``csrf_exempt`` already).
"""

from django.utils.translation import gettext_lazy as _
from rest_framework_simplejwt.authentication import (
    AUTH_HEADER_TYPE_BYTES,
    JWTAuthentication,
)
from rest_framework_simplejwt.exceptions import AuthenticationFailed

JWT_COOKIE_NAME = "jwt"

_HEADER_TYPES = {header_type.lower() for header_type in AUTH_HEADER_TYPE_BYTES}


class JWTCookieAuthentication(JWTAuthentication):
    """A bearer token from the header, else the access token in the cookie.

    The header wins: when it carries a bearer token the cookie is not looked
    at, and a bad header token fails the request exactly as it does with
    simplejwt's ``JWTAuthentication``.

    A cookie that cannot be used - expired, tampered with, a refresh token, a
    user who is gone or deactivated - authenticates nobody instead of failing
    the request. The browser keeps sending a stale cookie long after the access
    token in it expired, and a stale cookie must not turn a request that is
    allowed anonymously (a public photo, a shared album) into a 401. The view's
    permission checks then decide what an anonymous caller gets.
    """

    cookie_name = JWT_COOKIE_NAME

    def get_raw_token(self, header):
        """As simplejwt's, but the scheme is matched case-insensitively.

        RFC 7235 makes the scheme case-insensitive, and the upload endpoints
        always accepted ``bearer`` before they shared this class.
        """
        parts = header.split()
        if not parts or parts[0].lower() not in _HEADER_TYPES:
            return None
        if len(parts) != 2:
            raise AuthenticationFailed(
                _("Authorization header must contain two space-delimited values"),
                code="bad_authorization_header",
            )
        return parts[1]

    def header_token(self, request):
        """The raw bearer token in ``Authorization``, or None."""
        header = self.get_header(request)
        if header is None:
            return None
        return self.get_raw_token(header)

    def cookie_token(self, request):
        """The raw token in the ``jwt`` cookie, or None when there is no cookie.

        An empty cookie is returned as ``""``, not None: it was sent, it just
        cannot be used.
        """
        return request.COOKIES.get(self.cookie_name)

    def authenticate_token(self, raw_token):
        """``(user, validated_token)`` for ``raw_token``, or raise.

        Raises ``InvalidToken`` when the token itself is unusable and
        ``AuthenticationFailed`` when the user it names is missing or inactive.
        """
        validated_token = self.get_validated_token(raw_token)
        return self.get_user(validated_token), validated_token

    def authenticate(self, request):
        raw_token = self.header_token(request)
        if raw_token is not None:
            return self.authenticate_token(raw_token)
        raw_token = self.cookie_token(request)
        if raw_token is None:
            return None
        try:
            return self.authenticate_token(raw_token)
        except AuthenticationFailed:
            return None

    def authenticate_strict(self, request):
        """Like ``authenticate``, but an unusable cookie raises too.

        For callers outside DRF's view machinery that report bad credentials
        themselves (the chunked upload). Returns None when the request carries
        no token at all.
        """
        raw_token = self.header_token(request)
        if raw_token is None:
            raw_token = self.cookie_token(request)
        if raw_token is None:
            return None
        return self.authenticate_token(raw_token)
