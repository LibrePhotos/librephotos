"""What the Site Settings card shows an admin about the single sign-on setup.

The switches themselves are Constance settings (OIDC_*). The parts that cannot
be changed there are the providers (allauth SocialApps, edited in the Django
admin) and the public URL (FRONTEND_BASE_URL in the environment); the card warns
when either one keeps SSO from working.
"""

from django.http import HttpRequest

from api.accounts.public_url import is_internal_base_url, public_base_url


def sso_setup(request: HttpRequest) -> dict[str, object]:
    """Every OpenID Connect provider by name, whether allauth offers it on this
    site, and whether the public URL SSO needs is known.

    "On this site" uses the lookup allauth itself uses, so a provider shown as
    not attached is one whose login button would 404.
    """
    from allauth.socialaccount.models import SocialApp

    on_site = set(SocialApp.objects.on_site(request).values_list("id", flat=True))
    apps = SocialApp.objects.filter(provider="openid_connect").order_by("name")
    return {
        "sso_providers": [
            {"name": app.name, "on_this_site": app.id in on_site} for app in apps
        ],
        # The same check the SSO login makes before it redirects to the provider.
        "public_url_configured": not is_internal_base_url(public_base_url(request)),
    }
