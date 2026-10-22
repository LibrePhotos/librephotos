"""django-allauth adapters implementing LibrePhotos' OIDC/SSO login policy.

All of the security-sensitive decisions for single-sign-on live here rather than
in settings, because the adapter API is stable across allauth versions and can
read runtime state (the OIDC_* Constance flags, whether an email provider is
configured, and whether any superuser exists yet).

Policy (per the maintainer's steer on issue #401):

* **Hybrid login.** allauth only ever runs for the OIDC flow; regular
  username/password login is untouched (see AUTHENTICATION_BACKENDS).
* **No local allauth signup.** LibrePhotos has its own registration; allauth must
  never create an account through its own signup forms.
* **Verified email only.** An SSO login may connect to — or provision — a
  LibrePhotos account only when the identity provider asserts a *verified* email.
  Linking on an unverified email would let anyone who can register that address at
  the IdP take over an existing LibrePhotos account.
* **Admin-provisioned by default.** A first-time SSO login creates a new account
  only when the admin has turned on OIDC_ALLOW_SIGNUP *and* configured an email
  provider (so the verified-email claim is meaningful). Otherwise SSO only logs in
  users that already exist and whose email an admin has set to match the IdP.
* **Unambiguous email only.** When more than one account uses the provider's
  email, the login is refused rather than guessing or creating another one.
* **Never privileged.** An account created via SSO is never a superuser or staff,
  even during first-time setup when no superuser exists yet.
"""

import logging

from allauth.account.adapter import DefaultAccountAdapter
from allauth.core.exceptions import ImmediateHttpResponse
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from allauth.socialaccount.models import SocialLogin
from allauth.socialaccount.providers.base import AuthError, Provider
from constance import config as site_config
from django.forms import BaseForm
from django.http import HttpRequest, HttpResponseRedirect

from api.accounts.directories import auto_create_user_directory
from api.accounts.mail import email_is_configured
from api.models import User

logger = logging.getLogger(__name__)


def _login_error_redirect(reason: str) -> ImmediateHttpResponse:
    """Bounce back to the SPA login screen with a machine-readable reason.

    Relative URL on purpose: the browser resolves it against the origin it is
    actually talking to (the proxy), sidestepping the fact that the proxy
    rewrites the Host header to ``backend`` for ``/api/`` requests.
    """
    return ImmediateHttpResponse(HttpResponseRedirect(f"/login?sso_error={reason}"))


def _extract_email(sociallogin: SocialLogin) -> tuple[str, bool]:
    """Return (email, is_verified) for the incoming social login.

    Prefers allauth's parsed EmailAddress list (which reflects the provider's
    ``email_verified`` handling) and falls back to the raw OIDC claims.
    """
    email = ""
    verified = False
    for address in sociallogin.email_addresses:
        if address.email:
            email = address.email.strip().lower()
            verified = bool(address.verified)
            break
    if not email:
        extra = sociallogin.account.extra_data or {}
        email = (extra.get("email") or "").strip().lower()
        verified = bool(extra.get("email_verified", False))
    return email, verified


def _account_with_email(email: str) -> User | None:
    """The one LibrePhotos account using ``email``, or None if there is none.

    Only an unambiguous, non-empty match counts: many LibrePhotos users have a
    blank email, and a social identity must never be linked to the wrong (or
    every) account. Two or more matches refuse the login outright instead of
    falling through to sign-up, which would add yet another account with the
    same address.
    """
    if not email:
        return None
    matches = list(User.objects.filter(email__iexact=email)[:2])
    if len(matches) > 1:
        raise _login_error_redirect("email_ambiguous")
    return matches[0] if matches else None


def _describe_auth_error(
    request: HttpRequest,
    error: str | None,
    exception: BaseException | None,
    extra_context: dict[str, object] | None,
) -> str:
    """One line saying why allauth gave up, for the server log.

    The login page only gets a generic reason; this is what an admin needs to
    fix the provider setup.
    """
    if exception is not None:
        return f"{type(exception).__name__}: {exception}"
    if extra_context and "state_id" in extra_context:
        return (
            "the state check failed (the login expired, was replayed, or started "
            "in another browser)"
        )
    idp_error = request.GET.get("error", "")
    description = request.GET.get("error_description", "")
    return f"error={error} idp_error={idp_error!r} description={description!r}"


class NoLocalSignupAccountAdapter(DefaultAccountAdapter):
    """Disable allauth's own username/password signup entirely.

    LibrePhotos owns local registration; allauth is present purely to broker
    OIDC. This closes the door on allauth ever creating a local account.
    """

    def is_open_for_signup(self, request: HttpRequest) -> bool:
        return False


class SSOSocialAccountAdapter(DefaultSocialAccountAdapter):
    def _provisioning_allowed(self) -> bool:
        """Whether a first-time SSO login may create a new LibrePhotos account."""
        return bool(site_config.OIDC_ALLOW_SIGNUP) and email_is_configured()

    def is_open_for_signup(
        self, request: HttpRequest, sociallogin: SocialLogin
    ) -> bool:
        return self._provisioning_allowed()

    def pre_social_login(self, request: HttpRequest, sociallogin: SocialLogin) -> None:
        """Enforce the linking/provisioning policy before allauth commits.

        Runs after the IdP round-trip but before a user is logged in or created.
        """
        # The social account is already linked to a LibrePhotos user: nothing to
        # decide, let the login proceed.
        if sociallogin.is_existing:
            return

        email, verified = _extract_email(sociallogin)
        existing = _account_with_email(email)

        if existing is not None:
            if not verified:
                # Account-takeover guard: refuse to attach an unverified IdP
                # email to an existing local account.
                raise _login_error_redirect("email_not_verified")
            sociallogin.connect(request, existing)
            return

        # No existing account -> this would be a brand-new signup.
        if not self._provisioning_allowed():
            raise _login_error_redirect("signup_disabled")
        if not verified:
            raise _login_error_redirect("email_not_verified")
        # Fall through: allauth proceeds to save_user() below.

    def on_authentication_error(
        self,
        request: HttpRequest,
        provider: Provider,
        error: str | None = None,
        exception: BaseException | None = None,
        extra_context: dict[str, object] | None = None,
    ) -> None:
        """Send identity-provider failures to the SPA login page.

        Without this allauth renders its own unstyled error page under
        ``/api/accounts/``. The reason stays generic for the user; the details go
        to the server log.
        """
        logger.warning(
            "SSO login via %s failed: %s",
            getattr(provider, "id", provider),
            _describe_auth_error(request, error, exception, extra_context),
        )
        if error == AuthError.CANCELLED:
            raise _login_error_redirect("provider_cancelled")
        raise _login_error_redirect("provider_error")

    def save_user(
        self,
        request: HttpRequest,
        sociallogin: SocialLogin,
        form: BaseForm | None = None,
    ) -> User:
        """Create the LibrePhotos account, forced non-privileged.

        Even during first-time setup (no superuser yet) an SSO-provisioned user
        must never become a superuser or staff member.
        """
        user = super().save_user(request, sociallogin, form=form)
        if user.is_superuser or user.is_staff:
            user.is_superuser = False
            user.is_staff = False
            user.save(update_fields=["is_superuser", "is_staff"])
        auto_create_user_directory(user)
        return user
