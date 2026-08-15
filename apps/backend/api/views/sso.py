"""The OIDC/SSO -> JWT bridge, plus the login-screen discovery endpoint.

LibrePhotos authenticates with simplejwt, not Django sessions. allauth runs the
OIDC redirect/callback dance and, on success, establishes a short-lived Django
session and redirects to ``LOGIN_REDIRECT_URL`` (this module's ``sso_finish``).
``sso_finish`` mints the *same* access/refresh pair the password login issues,
sets the cookies the SPA reads on boot, and redirects into the app — so an SSO
login is indistinguishable from a password login everywhere downstream.
"""

from allauth.socialaccount.models import SocialApp
from allauth.socialaccount.providers.oauth2.views import (
    OAuth2CallbackView,
    OAuth2LoginView,
)
from allauth.socialaccount.providers.openid_connect.views import (
    OpenIDConnectOAuth2Adapter,
)
from constance import config as site_config
from django.contrib.auth import logout as django_logout
from django.contrib.auth.decorators import login_not_required
from django.http import Http404, HttpResponseRedirect
from django.urls import reverse
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from api.public_url import is_internal_base_url, public_base_url


class LibrePhotosOIDCAdapter(OpenIDConnectOAuth2Adapter):
    """Builds the OAuth ``redirect_uri`` from the configured public URL.

    allauth derives the callback from ``request.build_absolute_uri()``, which
    behind the standard proxy resolves to ``http://backend/...`` — the browser
    cannot follow that, and the IdP would reject it as an unregistered redirect
    URI. The public origin has to come from configuration instead; see
    api/public_url.py for why the request cannot tell us.

    The value must also be byte-identical between the authorize request and the
    later token exchange, which a configured constant guarantees and a
    request-derived one does not (a user reaching the same install by LAN IP and
    by domain would otherwise produce a mismatch).
    """

    def get_callback_url(self, request, app):
        base = public_base_url(request)
        path = reverse(
            "openid_connect_callback", kwargs={"provider_id": self.provider_id}
        )
        return f"{base}{path}"


def _oidc_view(view_class, request, provider_id):
    """Run one of allauth's OAuth2 views against our adapter subclass.

    allauth's own ``oidc/<id>/login/`` and ``.../callback/`` views hardcode the
    stock adapter, so we serve those two paths ourselves to substitute ours.
    Everything else about the flow is unchanged allauth.

    Both paths are gated on OIDC_ENABLED so that the flag is an actual off switch
    and not merely a hidden button: an admin turning SSO off (say, because the
    IdP was compromised) must stop these endpoints working, not just stop
    advertising them. 404 rather than an error page — when SSO is off, this
    genuinely is not a thing the server does.
    """
    if not site_config.OIDC_ENABLED:
        raise Http404
    try:
        view = view_class.adapter_view(LibrePhotosOIDCAdapter(request, provider_id))
        return view(request)
    except SocialApp.DoesNotExist:
        # Raised when the URL names a provider_id no SocialApp defines — and note
        # it surfaces from the view's dispatch, not from building the adapter, so
        # the call has to be inside the try (allauth's own view wraps only the
        # construction and lets this escape as a 500).
        raise Http404


@login_not_required
def oidc_login(request, provider_id):
    """Start the OIDC redirect, refusing early if we have no public URL to give.

    Without this guard allauth would happily send the browser to the IdP with
    ``redirect_uri=http://backend/...``, and the user would land on an opaque
    provider-side error instead of something that names the actual problem.
    """
    if site_config.OIDC_ENABLED and is_internal_base_url(public_base_url(request)):
        return HttpResponseRedirect("/login?sso_error=public_url_not_configured")
    return _oidc_view(OAuth2LoginView, request, provider_id)


@login_not_required
def oidc_callback(request, provider_id):
    return _oidc_view(OAuth2CallbackView, request, provider_id)


def _mint_jwt_for(user):
    """Issue a LibrePhotos access/refresh pair with the standard custom claims.

    Imported lazily from the root URLconf to reuse the exact claim logic the
    password login uses without creating an import cycle at settings-load time.
    """
    from librephotos.urls import CustomTokenObtainPairSerializer

    refresh = CustomTokenObtainPairSerializer.get_token(user)
    return str(refresh.access_token), str(refresh)


def _set_auth_cookies(response, access, refresh):
    # Mirror CustomTokenObtainPairView: the SPA reads these cookies (via
    # react-cookie) to boot already authenticated. Not HttpOnly, matching the
    # existing password-login behaviour so the client can read them.
    response.set_cookie("access", access)
    response.set_cookie("refresh", refresh)
    response.set_cookie("jwt", access)
    response["Access-Control-Allow-Credentials"] = "true"
    return response


def sso_finish(request):
    """allauth's post-login landing: mint the JWT and hand off to the SPA."""
    if not request.user.is_authenticated:
        return HttpResponseRedirect("/login?sso_error=not_authenticated")

    access, refresh = _mint_jwt_for(request.user)

    # The Django session was only a vehicle for the allauth handshake; the app
    # runs on JWT, so drop it to avoid leaving a second, session-based auth path.
    django_logout(request)

    response = HttpResponseRedirect("/")
    _set_auth_cookies(response, access, refresh)
    return response


class SSOConfigView(APIView):
    """Public: tells the login screen whether to show the SSO button and where
    it should point. Returns nothing sensitive — only enabled providers' display
    names and their allauth login URLs."""

    permission_classes = (AllowAny,)
    authentication_classes = ()

    def get(self, request):
        from allauth.socialaccount.models import SocialApp

        enabled = bool(site_config.OIDC_ENABLED)
        providers = []
        if enabled:
            for app in SocialApp.objects.filter(provider="openid_connect"):
                provider_id = app.provider_id or app.client_id
                try:
                    login_url = reverse(
                        "openid_connect_login",
                        kwargs={"provider_id": provider_id},
                    )
                except Exception:
                    # A misconfigured SocialApp shouldn't break the login screen.
                    continue
                providers.append(
                    {"id": provider_id, "name": app.name, "login_url": login_url}
                )

        return Response(
            {
                "enabled": enabled and len(providers) > 0,
                "label": site_config.OIDC_BUTTON_LABEL,
                "providers": providers,
            }
        )
