"""Settings for the single-container ("unified") image.

That image ships without an NGINX proxy and without a separate frontend
container: Django serves the collected frontend build itself through WhiteNoise,
and the database defaults to SQLite so the image runs standalone. Everything
else is the ordinary production deployment, so this module imports `production`
and overrides only what dropping the proxy actually changes - the same shape as
`development` and `test`.

It used to be a full copy of production.py sitting at
deploy/docker/unified/production_noproxy.py that the entrypoint pasted over the
real settings at boot. Nothing kept the copy in step, so it fell behind: keys
added to CONSTANCE_CONFIG (MAP_TILE_PROVIDER, later OCR_MODEL) never reached it
and SiteSettingsView, which reads them unconditionally, answered every
`GET /api/sitesettings` with a 500 - taking the whole UI down, since the
frontend calls that endpoint before login. Overriding instead of copying makes
that class of drift impossible.

deploy/docker/unified/entrypoint.sh selects this module by exporting
DJANGO_SETTINGS_MODULE when SERVE_FRONTEND is set.
"""

import os

from django.core.exceptions import ImproperlyConfigured

from .production import *  # noqa

# librephotos/urls.py hangs the SPA catch-all off this, and api/views/views.py
# reads it to decide whether '/' still belongs to DRF's API root. This module is
# the frontend-serving deployment, so it is on unconditionally rather than
# re-read from the environment variable the entrypoint already checked.
SERVE_FRONTEND = True

# WhiteNoise serves the collected frontend build straight out of Gunicorn.
# BASE_DIR is /code/librephotos, so the build the Dockerfile drops in sits one
# level up, at /code/frontend_build.
STATIC_URL = "/static/"
STATICFILES_DIRS = [os.path.join(os.path.dirname(BASE_DIR), "frontend_build")]  # noqa
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

# Directly after SecurityMiddleware, which is where WhiteNoise wants to sit.
# Derived from production's list rather than restated, so middleware added there
# arrives here too.
MIDDLEWARE = list(MIDDLEWARE)  # noqa
MIDDLEWARE.insert(
    MIDDLEWARE.index("django.middleware.security.SecurityMiddleware") + 1,
    "whitenoise.middleware.WhiteNoiseMiddleware",
)

# Nothing in front of this container rewrites the Host header, and the user
# reaches it on whatever name their compose file or reverse proxy exposes.
ALLOWED_HOSTS = ["*"]

# Frontend and API share an origin here, so CORS gates nothing a same-origin
# request could not do anyway. Leaving it open keeps direct API clients - the
# mobile app, scripts - working against a bare container.
CORS_ALLOW_ALL_ORIGINS = True

# production seeds this with the split dev setup's http://localhost:3000, which
# means nothing in this deployment. Take the operator's own origins instead, as
# a comma-separated list.
CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get("CSRF_TRUSTED_ORIGINS", "").split(",")
    if origin.strip()
]

# Headers NGINX adds for us in the split deployment.
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_BROWSER_XSS_FILTER = True
X_FRAME_OPTIONS = "DENY"

# Database backend, chosen with DB_BACKEND. SQLite is the default so a plain
# `docker run` needs no companion service; PostgreSQL keeps production's
# configuration verbatim.
DB_BACKEND = os.environ.get("DB_BACKEND", "sqlite").lower()

if DB_BACKEND == "sqlite":
    # Production-oriented pragmas, following
    # https://alldjango.com/articles/definitive-guide-to-using-django-sqlite-in-production
    db_dir = os.path.join(BASE_DATA, "db")  # noqa
    os.makedirs(db_dir, exist_ok=True)
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": os.path.join(db_dir, "librephotos.sqlite3"),
            "OPTIONS": {
                "transaction_mode": "IMMEDIATE",
                "timeout": 5,  # seconds
                "init_command": """
                    PRAGMA journal_mode=WAL;
                    PRAGMA synchronous=NORMAL;
                    PRAGMA mmap_size=134217728;
                    PRAGMA journal_size_limit=27103364;
                    PRAGMA cache_size=2000;
                """,
            },
        },
    }
    # django.contrib.postgres registers PostgreSQL-only lookups and operations,
    # so it comes back out of the app list when the database is not PostgreSQL.
    INSTALLED_APPS = [  # noqa
        app
        for app in INSTALLED_APPS  # noqa
        if app != "django.contrib.postgres"
    ]
    print("Using production-optimized SQLite database")
elif DB_BACKEND == "postgresql":
    # DATABASES and django.contrib.postgres are inherited from production.
    print("Using PostgreSQL database")
else:
    raise ImproperlyConfigured(
        f"Unsupported DB_BACKEND: {DB_BACKEND}. Use 'postgresql' or 'sqlite'"
    )
