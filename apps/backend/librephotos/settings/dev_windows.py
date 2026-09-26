"""Native Windows dev server: production settings, SQLite on disk, media served
by Django (no nginx). Started by scripts/dev_windows.ps1."""

import os

from .production import *  # noqa: E402,F401,F403

# DEBUG=True makes Django re-interpolate migration SQL containing "%"; opt in.
DEBUG = os.environ.get("DJANGO_DEBUG", "0") == "1"

ALLOWED_HOSTS = ["*"]
CORS_ALLOW_ALL_ORIGINS = True

# Stream media from Django instead of X-Accel-Redirect (see UnifiedMediaAccessView).
SERVE_FRONTEND = True


def _opt_in(name):
    return os.environ.get(name, "").strip().lower() in ("true", "1", "yes", "on")


# dev_windows.ps1 starts no ML sidecar, so default these off; flip one on and
# `manage.py start_service <name>` to use it.
FEATURE_FACE_DETECTION = _opt_in("FEATURE_FACE_DETECTION")
FEATURE_FACE_CLUSTER = _opt_in("FEATURE_FACE_CLUSTER")
FEATURE_IMAGE_CAPTIONING = _opt_in("FEATURE_IMAGE_CAPTIONING")
FEATURE_SCENE_CLASSIFICATION = _opt_in("FEATURE_SCENE_CLASSIFICATION")

_DB_DIR = os.environ.get("BASE_DATA") or os.getcwd()
os.makedirs(_DB_DIR, exist_ok=True)

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": os.path.join(_DB_DIR, "librephotos-dev.sqlite3"),
        "OPTIONS": {
            "transaction_mode": "IMMEDIATE",
            "timeout": 30,
            "init_command": """
                PRAGMA journal_mode=WAL;
                PRAGMA synchronous=NORMAL;
                PRAGMA cache_size=2000;
            """,
        },
    },
}

INSTALLED_APPS = [  # noqa: F405
    app
    for app in INSTALLED_APPS  # noqa: F405
    if app != "django.contrib.postgres"
]

Q_CLUSTER = {**Q_CLUSTER, "workers": int(os.environ.get("WORKER_CONCURRENCY", "1"))}  # noqa: F405
