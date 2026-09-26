"""Django system checks for deployment configuration.

Registered from ``ApiConfig.ready``. Warnings surface wherever system checks
run, which includes the ``manage.py migrate`` every entrypoint runs on start.
"""

from django.conf import settings
from django.core import checks


def check_default_db_password(app_configs, **kwargs):
    """Warn when PostgreSQL is reached with the fallback password.

    ``DB_PASS`` falls back to the password shipped in librephotos.env so that
    old hand-written setups keep connecting (see the settings module); this
    makes sure that fallback is never silent.
    """
    if getattr(settings, "DB_PASS_FROM_ENV", True):
        return []
    database = settings.DATABASES.get("default", {})
    if "postgresql" not in database.get("ENGINE", ""):
        return []
    if database.get("PASSWORD") != getattr(
        settings, "INSECURE_DEFAULT_DB_PASSWORD", None
    ):
        return []
    return [
        checks.Warning(
            "DB_PASS is not set, so the database password falls back to the "
            "built-in default shared by every LibrePhotos install.",
            hint=(
                "Set DB_PASS (dbPass in librephotos.env) to the password of your "
                "PostgreSQL user. The fallback is kept only so existing installs "
                "keep working and may be removed in a future release."
            ),
            id="librephotos.W001",
        )
    ]
