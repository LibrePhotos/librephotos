"""The refresh token of a "Remember me" sign-in, and how long its cookies last.

A plain sign-in gets a refresh token for ``REFRESH_TOKEN_DAYS`` and session
cookies: closing the browser signs the user out. With "Remember me" (the
``remember_me`` flag of ``/api/auth/token/obtain/``) the refresh token lasts
``REMEMBER_ME_DAYS`` instead and carries a ``remember_until`` claim, the moment
it expires. simplejwt copies every claim but ``exp``/``iat``/``jti``/``token_type``
into the access tokens it mints from it, so each access token says how long
its session lasts. ``remembered_max_age`` reads that claim to give the ``jwt``
cookie a ``Max-Age``, on the sign-in and on every refresh, and the web does the
same for its ``access`` and ``refresh`` cookies (apps/frontend/src/api_client/authCookies.ts).
Nothing else stores the choice, so it cannot drift from the token.

The SSO bridge never sets the claim: single sign-on keeps session cookies.
"""

import datetime
from typing import cast

from django.conf import settings
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken, RefreshToken, Token

REMEMBER_UNTIL_CLAIM = "remember_until"


def remember_me_days() -> int:
    """Days a "Remember me" sign-in lasts; 0 turns the option off."""
    return max(0, int(settings.REMEMBER_ME_DAYS))


class RememberMeRefreshToken(RefreshToken):
    """A refresh token that lasts ``REMEMBER_ME_DAYS`` and says so in a claim.

    The lifetime is set while the token is built, before ``for_user`` records
    it as an outstanding token, so the blacklist knows its real expiry.
    """

    def __init__(self, token: Token | None = None, verify: bool = True) -> None:
        super().__init__(token, verify)
        if token is None:
            self.set_exp(
                from_time=self.current_time,
                lifetime=datetime.timedelta(days=remember_me_days()),
            )
            self[REMEMBER_UNTIL_CLAIM] = self["exp"]


def remembered_max_age(access: str) -> int | None:
    """Seconds the auth cookies of ``access`` should last, or None for session cookies.

    None when the token has no ``remember_until`` claim (a plain or SSO
    sign-in) or cannot be read; never negative.
    """
    try:
        # simplejwt annotates the encoded token as ``Token``, but Token.__init__
        # takes the encoded string and decodes it.
        remember_until = AccessToken(cast(Token, access)).get(REMEMBER_UNTIL_CLAIM)
    except TokenError:
        return None
    if not isinstance(remember_until, int):
        return None
    now = datetime.datetime.now(tz=datetime.UTC)
    return max(0, remember_until - int(now.timestamp()))
