"""Settings for the standalone build (see librephotos/standalone.py).

The same deployment shape as the unified container - SQLite, WhiteNoise
serving the frontend, no proxy - so this inherits production_noproxy and only
moves the two directories that differ. librephotos.standalone exports
BASE_DATA, BASE_LOGS and PHOTOS before this module is imported, so production
already derived the database, media and log locations from the data directory.
"""

import os

from .production_noproxy import *  # noqa

# BASE_DIR is <root>/librephotos both in the source tree and inside the Nuitka
# distribution, so <root> is the backend checkout at build time and the
# directory next to librephotos.exe at run time. The frontend build and the
# collected static files live there: scripts/build_standalone.py collects into
# <root>/static before compiling, and the distribution is read-only at run
# time, so nothing writes to STATIC_ROOT once built.
_ROOT = os.path.dirname(BASE_DIR)  # noqa
STATIC_ROOT = os.path.join(_ROOT, "static")
STATICFILES_DIRS = [os.path.join(_ROOT, "frontend_build")]

# The browser talks to 127.0.0.1 and nothing rewrites Host on the way.
CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in os.environ.get(
        "CSRF_TRUSTED_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000"
    ).split(",")
    if origin.strip()
]

# One person's desktop. Left alone django-q2 starts a worker per CPU core, and
# every worker is a full copy of the backend: a dozen processes and several GB
# of RAM on an ordinary PC, all queueing behind sidecars that serve one request
# at a time anyway. WORKER_CONCURRENCY still overrides it.
Q_CLUSTER = {  # noqa: F405
    **Q_CLUSTER,  # noqa: F405
    "workers": int(os.environ.get("WORKER_CONCURRENCY", "2")),
}
