from django.conf import settings
from django.db import models
from django_cryptography.fields import encrypt

# Provider presets. Selecting one of these in the UI pre-fills the SMTP host /
# port / TLS fields, so the administrator only has to supply the credential
# (an API key for most transactional providers) and a from-address.
#
# These are all SMTP *relay* endpoints: authentication uses a per-provider API
# key or SMTP credential, NOT a personal mailbox password, so they are immune
# to the Gmail / Microsoft 365 "basic auth" deprecation. `default_username`, if
# present, is the fixed username the provider mandates (e.g. SendGrid's literal
# "apikey"); otherwise the admin supplies the username.
PROVIDER_PRESETS = {
    "sendgrid": {
        "label": "SendGrid",
        "host": "smtp.sendgrid.net",
        "port": 587,
        "use_tls": True,
        "use_ssl": False,
        "default_username": "apikey",
        "help_url": "https://app.sendgrid.com/settings/api_keys",
    },
    "mailgun": {
        "label": "Mailgun",
        "host": "smtp.mailgun.org",
        "port": 587,
        "use_tls": True,
        "use_ssl": False,
        "help_url": "https://app.mailgun.com/app/sending/domains",
    },
    "postmark": {
        "label": "Postmark",
        "host": "smtp.postmarkapp.com",
        "port": 587,
        "use_tls": True,
        "use_ssl": False,
        "help_url": "https://account.postmarkapp.com/servers",
    },
    "brevo": {
        "label": "Brevo",
        "host": "smtp-relay.brevo.com",
        "port": 587,
        "use_tls": True,
        "use_ssl": False,
        "help_url": "https://app.brevo.com/settings/keys/smtp",
    },
    "smtp2go": {
        "label": "SMTP2GO",
        "host": "mail.smtp2go.com",
        "port": 587,
        "use_tls": True,
        "use_ssl": False,
        "help_url": "https://app.smtp2go.com/settings/users/",
    },
    # Amazon SES's SMTP endpoint is region-specific, so the admin supplies the
    # host; the rest of the defaults still apply.
    "ses": {
        "label": "Amazon SES",
        "port": 587,
        "use_tls": True,
        "use_ssl": False,
        "help_url": "https://docs.aws.amazon.com/ses/latest/dg/smtp-credentials.html",
    },
}

PROVIDER_CHOICES = [
    ("disabled", "Disabled"),
    ("custom", "Custom SMTP server"),
    ("sendgrid", "SendGrid"),
    ("mailgun", "Mailgun"),
    ("postmark", "Postmark"),
    ("brevo", "Brevo"),
    ("smtp2go", "SMTP2GO"),
    ("ses", "Amazon SES"),
]


class EmailConfig(models.Model):
    """Singleton holding the instance's outgoing-email configuration.

    Stored in the database (not the environment) so an administrator can manage
    it from the Site Settings UI, and the secret credential is encrypted at rest
    (Fernet, keyed off the install's SECRET_KEY via django-cryptography).

    Only ever one row (pk=1); use `EmailConfig.load()` to fetch it.
    """

    provider = models.CharField(
        max_length=32, choices=PROVIDER_CHOICES, default="disabled"
    )
    from_email = models.CharField(max_length=255, blank=True, default="")
    host = models.CharField(max_length=255, blank=True, default="")
    port = models.PositiveIntegerField(default=587)
    use_tls = models.BooleanField(default=True)
    use_ssl = models.BooleanField(default=False)
    username = models.CharField(max_length=255, blank=True, default="")
    # SMTP password or provider API key. Encrypted at rest.
    secret = encrypt(models.TextField(blank=True, default=""))

    class Meta:
        verbose_name = "Email configuration"
        verbose_name_plural = "Email configuration"

    def __str__(self):
        return f"EmailConfig(provider={self.provider})"

    def save(self, *args, **kwargs):
        # Enforce the singleton: there is only ever one configuration row.
        self.pk = 1
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    @property
    def effective_from_email(self):
        return self.from_email or getattr(settings, "DEFAULT_FROM_EMAIL", "")

    def resolve_smtp_kwargs(self):
        """Effective SMTP connection settings, merging any provider preset with
        the stored values (stored values win)."""
        preset = PROVIDER_PRESETS.get(self.provider, {})
        return {
            "host": self.host or preset.get("host", ""),
            "port": self.port or preset.get("port", 587),
            "username": self.username or preset.get("default_username", ""),
            "password": self.secret,
            "use_tls": self.use_tls,
            "use_ssl": self.use_ssl,
        }

    @property
    def is_configured(self):
        """True when this instance can actually send mail."""
        if self.provider == "disabled":
            return False
        kwargs = self.resolve_smtp_kwargs()
        return bool(kwargs["host"]) and bool(self.effective_from_email)
