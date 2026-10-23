"""Native Windows dev server: production settings, SQLite on disk, media served
by Django (no nginx). Started by scripts/dev_windows.ps1."""

import os

from librephotos.env import env_flag, env_int, env_str

from ._sqlite import SQLITE_SILENCED_CHECKS, sqlite_database
from .production import *  # noqa: E402,F401,F403

# DEBUG=True makes Django re-interpolate migration SQL containing "%"; opt in.
DEBUG = env_flag("DJANGO_DEBUG", default=False)

ALLOWED_HOSTS = ["*"]
CORS_ALLOW_ALL_ORIGINS = True

# Stream media from Django instead of X-Accel-Redirect (see UnifiedMediaAccessView).
SERVE_FRONTEND = True


# dev_windows.ps1 starts no ML sidecar, so default these off; flip one on and
# `manage.py start_service <name>` to use it.
FEATURE_FACE_DETECTION = env_flag("FEATURE_FACE_DETECTION", default=False)
FEATURE_FACE_CLUSTER = env_flag("FEATURE_FACE_CLUSTER", default=False)
FEATURE_IMAGE_CAPTIONING = env_flag("FEATURE_IMAGE_CAPTIONING", default=False)
FEATURE_SCENE_CLASSIFICATION = env_flag("FEATURE_SCENE_CLASSIFICATION", default=False)

_DB_DIR = env_str("BASE_DATA") or os.getcwd()
os.makedirs(_DB_DIR, exist_ok=True)

DATABASES = {
    "default": sqlite_database(os.path.join(_DB_DIR, "librephotos-dev.sqlite3"))
}
SILENCED_SYSTEM_CHECKS = SQLITE_SILENCED_CHECKS

INSTALLED_APPS = [  # noqa: F405
    app
    for app in INSTALLED_APPS  # noqa: F405
    if app != "django.contrib.postgres"
]

Q_CLUSTER = {**Q_CLUSTER, "workers": env_int("WORKER_CONCURRENCY", 1)}  # noqa: F405
