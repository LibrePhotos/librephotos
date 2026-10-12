"""Database-backed outgoing-email backend.

`DynamicEmailBackend` reads the (admin-configured, DB-stored) `EmailConfig` at
send time and delegates to Django's real SMTP backend. Every feature that wants
to send mail just uses Django's normal `send_mail`/`EmailMessage`; routing is
handled here, so email configuration is a shared instance capability rather than
something baked into any single feature.

When email is not configured the backend is a safe no-op (or the console backend
under DEBUG, so reset links are still visible in dev logs).
"""

import logging
from collections.abc import Sequence

from django.conf import settings
from django.core.mail import EmailMessage
from django.core.mail.backends.base import BaseEmailBackend
from django.core.mail.backends.console import EmailBackend as ConsoleBackend
from django.core.mail.backends.smtp import EmailBackend as SMTPBackend
from django.core.signing import BadSignature
from django.db import DatabaseError

logger = logging.getLogger(__name__)


def email_is_configured() -> bool:
    """Whether this instance can send mail. Safe to call before migrations.

    False when the table is not there yet (``DatabaseError``) or the stored
    secret no longer decrypts, which is what a changed ``SECRET_KEY`` does.
    """
    from api.models.email_config import EmailConfig

    try:
        return EmailConfig.load().is_configured
    except DatabaseError:
        return False
    except BadSignature:
        logger.warning(
            "The stored email secret does not decrypt (was SECRET_KEY changed?); "
            "outgoing email is off until it is saved again."
        )
        return False


class DynamicEmailBackend(BaseEmailBackend):
    def _delegate(self) -> BaseEmailBackend | None:
        from api.models.email_config import EmailConfig

        config = EmailConfig.load()
        if config.is_configured:
            return SMTPBackend(
                fail_silently=self.fail_silently, **config.resolve_smtp_kwargs()
            )
        if getattr(settings, "DEBUG", False):
            # Keep the dev workflow: unconfigured email prints to the log.
            return ConsoleBackend(fail_silently=self.fail_silently)
        return None

    def send_messages(self, email_messages: Sequence[EmailMessage]) -> int:
        if not email_messages:
            return 0
        backend = self._delegate()
        if backend is None:
            logger.warning(
                "Outgoing email is not configured; %d message(s) not sent.",
                len(email_messages),
            )
            return 0
        return backend.send_messages(email_messages)
