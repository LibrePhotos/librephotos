"""The bodies of the email settings views (``api/views/email_config.py``)."""

from typing import Any

from rest_framework import serializers

from api.models.email_config import EmailConfig


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
