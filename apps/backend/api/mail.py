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

from django.conf import settings
from django.core.mail.backends.base import BaseEmailBackend
from django.core.mail.backends.console import EmailBackend as ConsoleBackend
from django.core.mail.backends.smtp import EmailBackend as SMTPBackend

logger = logging.getLogger(__name__)


def email_is_configured():
    """Whether this instance can send mail. Safe to call before migrations."""
    try:
        from api.models.email_config import EmailConfig

        return EmailConfig.load().is_configured
    except Exception:
        return False


class DynamicEmailBackend(BaseEmailBackend):
    def _delegate(self):
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

    def send_messages(self, email_messages):
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
