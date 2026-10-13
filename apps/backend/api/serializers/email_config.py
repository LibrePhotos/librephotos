"""The bodies and answers of the email settings views (``api/views/email_config.py``).

The answers are only for the OpenAPI schema: the views build the dicts.
"""

from typing import Any

from rest_framework import serializers

from api.models.email_config import PROVIDER_CHOICES, EmailConfig
from api.serializers.fields import declare_fields


class EmailConfigRequest(serializers.ModelSerializer[EmailConfig]):
    """An update of the instance email configuration; every field is optional.

    The model's own constraints apply (provider choices, a positive port, the
    column lengths); text is stored as sent, not trimmed. ``secret`` is
    write-only: a non-empty value replaces the stored credential, a blank or
    absent one leaves it, and ``clear_secret`` wipes it (it wins over a new
    ``secret``).
    """

    secret = serializers.CharField(
        required=False,
        allow_blank=True,
        allow_null=True,
        trim_whitespace=False,
        write_only=True,
        help_text="A new SMTP password or API key; blank keeps the stored one",
    )
    clear_secret = serializers.BooleanField(
        required=False, allow_null=True, help_text="Remove the stored credential"
    )

    class Meta:
        model = EmailConfig
        fields = (
            "provider",
            "from_email",
            "host",
            "port",
            "use_tls",
            "use_ssl",
            "username",
            "secret",
            "clear_secret",
        )
        extra_kwargs = {
            name: {"trim_whitespace": False}
            for name in ("from_email", "host", "username")
        }

    def update(
        self, instance: EmailConfig, validated_data: dict[str, Any]
    ) -> EmailConfig:
        clear_secret = validated_data.pop("clear_secret", False)
        secret = validated_data.pop("secret", None)
        for field, value in validated_data.items():
            setattr(instance, field, value)
        if clear_secret:
            instance.secret = ""
        elif secret:
            instance.secret = secret
        instance.save()
        return instance


class EmailTestRequest(serializers.Serializer[None]):
    to = serializers.CharField(
        default="",
        allow_blank=True,
        allow_null=True,
        help_text="The recipient; the requesting admin's address when blank",
    )


class EmailProviderPresetSerializer(serializers.Serializer[None]):
    """One of ``PROVIDER_PRESETS``: what choosing the provider fills in."""

    host = serializers.CharField(
        required=False,
        help_text="Absent for Amazon SES (its host depends on the region)",
    )
    port = serializers.IntegerField()
    use_tls = serializers.BooleanField()
    use_ssl = serializers.BooleanField()
    default_username = serializers.CharField(
        required=False, help_text="The user name the provider requires, if any"
    )
    help_url = serializers.URLField(help_text="Where to create the credential")


declare_fields(EmailProviderPresetSerializer, label=serializers.CharField())


class EmailConfigResponseSerializer(serializers.Serializer[None]):
    """``GET``/``POST /api/email-config/``: the configuration without its secret."""

    provider = serializers.ChoiceField(choices=PROVIDER_CHOICES)
    from_email = serializers.CharField(allow_blank=True)
    host = serializers.CharField(allow_blank=True)
    port = serializers.IntegerField()
    use_tls = serializers.BooleanField()
    use_ssl = serializers.BooleanField()
    username = serializers.CharField(allow_blank=True)
    has_secret = serializers.BooleanField(help_text="Whether a credential is stored")
    is_configured = serializers.BooleanField(help_text="Whether email can be sent")
    presets = serializers.DictField(
        child=EmailProviderPresetSerializer(), help_text="By provider"
    )


class EmailTestResponseSerializer(serializers.Serializer[None]):
    status = serializers.BooleanField(help_text="Always true; a failure is an error")
    message = serializers.CharField(help_text="Which address the email went to")
