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
* **Never privileged.** An account created via SSO is never a superuser or staff,
  even during first-time setup when no superuser exists yet.
"""

from allauth.account.adapter import DefaultAccountAdapter
from allauth.core.exceptions import ImmediateHttpResponse
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from constance import config as site_config
from django.http import HttpResponseRedirect

from api.mail import email_is_configured
from api.models import User


def _login_error_redirect(reason):
    """Bounce back to the SPA login screen with a machine-readable reason.

    Relative URL on purpose: the browser resolves it against the origin it is
    actually talking to (the proxy), sidestepping the fact that the proxy
    rewrites the Host header to ``backend`` for ``/api/`` requests.
    """
    return ImmediateHttpResponse(HttpResponseRedirect(f"/login?sso_error={reason}"))


def _extract_email(sociallogin):
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


class NoLocalSignupAccountAdapter(DefaultAccountAdapter):
    """Disable allauth's own username/password signup entirely.

    LibrePhotos owns local registration; allauth is present purely to broker
    OIDC. This closes the door on allauth ever creating a local account.
    """

    def is_open_for_signup(self, request):
        return False


class SSOSocialAccountAdapter(DefaultSocialAccountAdapter):
    def _provisioning_allowed(self):
        """Whether a first-time SSO login may create a new LibrePhotos account."""
        return bool(site_config.OIDC_ALLOW_SIGNUP) and email_is_configured()

    def is_open_for_signup(self, request, sociallogin):
        return self._provisioning_allowed()

    def pre_social_login(self, request, sociallogin):
        """Enforce the linking/provisioning policy before allauth commits.

        Runs after the IdP round-trip but before a user is logged in or created.
        """
        # The social account is already linked to a LibrePhotos user: nothing to
        # decide, let the login proceed.
        if sociallogin.is_existing:
            return

        email, verified = _extract_email(sociallogin)

        # Try to match an existing account by email. Only an unambiguous,
        # non-empty match counts — many LibrePhotos users have a blank email, and
        # we must never link a social identity to the wrong (or every) account.
        existing = None
        if email:
            matches = list(User.objects.filter(email__iexact=email))
            if len(matches) == 1:
                existing = matches[0]

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

    def save_user(self, request, sociallogin, form=None):
        """Create the LibrePhotos account, forced non-privileged.

        Even during first-time setup (no superuser yet) an SSO-provisioned user
        must never become a superuser or staff member.
        """
        user = super().save_user(request, sociallogin, form=form)
        if user.is_superuser or user.is_staff:
            user.is_superuser = False
            user.is_staff = False
            user.save(update_fields=["is_superuser", "is_staff"])
        return user
