import logging

from django.core.mail import send_mail
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAdminUser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.drf.exceptions import UpstreamError
from api.drf.params import parse_body
from api.drf.request_data import request_dict
from api.drf.request_user import request_user
from api.models.email_config import PROVIDER_PRESETS, EmailConfig
from api.serializers.email_config import (
    EmailConfigRequest,
    EmailConfigResponseSerializer,
    EmailTestRequest,
    EmailTestResponseSerializer,
)

logger = logging.getLogger(__name__)


def _serialize(config: EmailConfig) -> dict[str, object]:
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

    @extend_schema(responses=EmailConfigResponseSerializer)
    def get(self, request: Request, format: str | None = None) -> Response:
        return Response(_serialize(EmailConfig.load()))

    @extend_schema(request=EmailConfigRequest, responses=EmailConfigResponseSerializer)
    def post(self, request: Request, format: str | None = None) -> Response:
        # A partial update; the secret is write-only (see EmailConfigRequest).
        serializer = EmailConfigRequest(
            EmailConfig.load(), data=request_dict(request), partial=True
        )
        serializer.is_valid(raise_exception=True)
        return Response(_serialize(serializer.save()))


class EmailTestView(APIView):
    """Send a test email to verify the configuration end-to-end."""

    permission_classes = (IsAdminUser,)

    @extend_schema(request=EmailTestRequest, responses=EmailTestResponseSerializer)
    def post(self, request: Request, format: str | None = None) -> Response:
        config = EmailConfig.load()
        if not config.is_configured:
            raise ValidationError(
                "Email is not configured.", code="email_not_configured"
            )

        to = parse_body(request, EmailTestRequest)["to"]
        recipient = (to or request_user(request).email or "").strip()
        if not recipient:
            raise ValidationError(
                {
                    "to": "No recipient address; set an email on your account "
                    "or provide one."
                }
            )

        try:
            send_mail(
                "LibrePhotos test email",
                "This is a test message from LibrePhotos. If you received it, your "
                "email configuration is working.",
                config.effective_from_email,
                [recipient],
            )
        except Exception as exc:
            logger.exception("Test email failed")
            # The mail server refused: a 502 carrying its own words, so the
            # admin (the only caller) can see what went wrong.
            raise UpstreamError(str(exc), code="email_send_failed") from exc

        return Response({"status": True, "message": f"Test email sent to {recipient}."})
