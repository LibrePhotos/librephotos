import logging

from django.contrib.auth import get_user_model
from django.contrib.auth.password_validation import validate_password
from django.contrib.auth.tokens import default_token_generator
from django.core.exceptions import ValidationError
from django.core.mail import send_mail
from django.utils.encoding import force_bytes, force_str
from django.utils.http import urlsafe_base64_decode, urlsafe_base64_encode
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView

from api.public_url import public_base_url

logger = logging.getLogger(__name__)

User = get_user_model()


class PasswordResetView(APIView):
    """Request a password-reset email.

    Always responds 200 regardless of whether the address matches a user, so
    the endpoint cannot be used to enumerate registered email addresses.
    """

    permission_classes = (AllowAny,)
    throttle_classes = (ScopedRateThrottle,)
    throttle_scope = "password_reset"

    def post(self, request, format=None):
        email = (request.data.get("email") or "").strip()
        if email:
            user = User.objects.filter(email__iexact=email).first()
            if user is not None and user.email:
                self._send_reset_email(request, user)
        return Response(
            {
                "status": True,
                "message": "If an account exists for that email, a reset link "
                "has been sent.",
            }
        )

    def _send_reset_email(self, request, user):
        uid = urlsafe_base64_encode(force_bytes(user.pk))
        token = default_token_generator.make_token(user)
        base = public_base_url(request)
        link = f"{base}/password-reset/confirm/{uid}/{token}"

        subject = "Reset your LibrePhotos password"
        body = (
            f"Hello {user.get_username()},\n\n"
            "We received a request to reset the password for your LibrePhotos "
            "account. Open the link below to choose a new password:\n\n"
            f"{link}\n\n"
            "If you did not request this, you can safely ignore this email; your "
            "password will not change.\n"
        )
        try:
            from api.models.email_config import EmailConfig

            from_email = EmailConfig.load().effective_from_email
            send_mail(
                subject,
                body,
                from_email,
                [user.email],
                fail_silently=False,
            )
        except Exception:
            # Never surface delivery failures to the caller (that would leak
            # whether the address exists); log for the administrator instead.
            logger.exception("Failed to send password-reset email")


class PasswordResetConfirmView(APIView):
    """Complete a password reset using the token from the emailed link."""

    permission_classes = (AllowAny,)

    def post(self, request, format=None):
        uid = request.data.get("uid")
        token = request.data.get("token")
        new_password = request.data.get("new_password")

        if not uid or not token or not new_password:
            return Response(
                {"status": False, "message": "Missing parameters"}, status=400
            )

        user = self._user_from_uid(uid)
        if user is None or not default_token_generator.check_token(user, token):
            return Response(
                {"status": False, "message": "Invalid or expired reset link"},
                status=400,
            )

        try:
            validate_password(new_password, user)
        except ValidationError as exc:
            return Response(
                {"status": False, "message": " ".join(exc.messages)}, status=400
            )

        user.set_password(new_password)
        user.save()
        return Response({"status": True, "message": "Password has been reset"})

    def _user_from_uid(self, uid):
        try:
            pk = force_str(urlsafe_base64_decode(uid))
            return User.objects.get(pk=pk)
        except (TypeError, ValueError, OverflowError, User.DoesNotExist):
            return None
