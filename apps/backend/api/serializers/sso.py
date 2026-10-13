"""The answer of the SSO login-screen config (``api/views/sso.py``).

Only for the OpenAPI schema: the view builds the dict.
"""

from rest_framework import serializers

from api.serializers.fields import declare_fields


class SSOProviderSerializer(serializers.Serializer[None]):
    id = serializers.CharField(help_text="The OIDC provider id")
    name = serializers.CharField(help_text="What the login button says it is")
    login_url = serializers.CharField(help_text="Where the login button points")


class SSOConfigSerializer(serializers.Serializer[None]):
    """``GET /api/auth/sso/config/``: whether to show the SSO login button."""

    enabled = serializers.BooleanField(
        help_text="SSO is on and at least one provider has a login URL"
    )
    providers = SSOProviderSerializer(many=True, help_text="Empty while SSO is off")


declare_fields(
    SSOConfigSerializer,
    label=serializers.CharField(allow_blank=True, help_text="The button's label"),
)
