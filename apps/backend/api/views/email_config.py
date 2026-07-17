import logging

from django.core.mail import send_mail
from rest_framework.permissions import IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from api.models.email_config import PROVIDER_PRESETS, EmailConfig

logger = logging.getLogger(__name__)

_WRITABLE_FIELDS = (
    "provider",
    "from_email",
    "host",
    "port",
    "use_tls",
    "use_ssl",
    "username",
)


def _serialize(config):
    """Non-secret representation of the config. The stored secret is NEVER
    returned; only whether one is set."""
    return {
        "provider": config.provider,
        "from_email": config.from_email,
        "host": config.host,
        "port": config.port,
        "use_tls": config.use_tls,
        "use_ssl": config.use_ssl,
        "username": config.username,
        "has_secret": bool(config.secret),
        "is_configured": config.is_configured,
        "presets": PROVIDER_PRESETS,
    }


class EmailConfigView(APIView):
    """Admin-only read/write of the instance email configuration."""

    permission_classes = (IsAdminUser,)

    def get(self, request, format=None):
        return Response(_serialize(EmailConfig.load()))

    def post(self, request, format=None):
        config = EmailConfig.load()
        data = request.data

        for field in _WRITABLE_FIELDS:
            if field in data:
                setattr(config, field, data[field])

        # The secret is write-only: a non-empty value replaces it; an absent or
        # empty value leaves the stored credential untouched. `clear_secret`
        # explicitly wipes it.
        if data.get("clear_secret"):
            config.secret = ""
        elif data.get("secret"):
            config.secret = data["secret"]

        config.save()
        return Response(_serialize(config))


class EmailTestView(APIView):
    """Send a test email to verify the configuration end-to-end."""

    permission_classes = (IsAdminUser,)

    def post(self, request, format=None):
        config = EmailConfig.load()
        if not config.is_configured:
            return Response(
                {"status": False, "message": "Email is not configured."}, status=400
            )

        recipient = (request.data.get("to") or request.user.email or "").strip()
        if not recipient:
            return Response(
                {
                    "status": False,
                    "message": "No recipient address; set an email on your account "
                    "or provide one.",
                },
                status=400,
            )

        try:
            send_mail(
                "LibrePhotos test email",
                "This is a test message from LibrePhotos. If you received it, your "
                "email configuration is working.",
                config.effective_from_email,
                [recipient],
                fail_silently=False,
            )
        except Exception as exc:
            logger.exception("Test email failed")
            # 200 with the real error so the admin can see what went wrong.
            return Response({"status": False, "message": str(exc)})

        return Response({"status": True, "message": f"Test email sent to {recipient}."})
