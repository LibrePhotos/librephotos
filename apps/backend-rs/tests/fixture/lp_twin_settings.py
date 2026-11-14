"""Django settings for the reference server and the fixture build.

Production settings on PostgreSQL, reachable on any host name. With
LP_DJANGO_DIRECT=1 Django streams media itself (SERVE_FRONTEND) instead of
answering with an empty X-Accel-Redirect body for nginx. With LP_DJANGO_MOCK
set, sidecar calls go to the mock (lp_twin_mock).
"""

import os

from librephotos.settings.production import *  # noqa: F403

ALLOWED_HOSTS = ["*"]
CORS_ALLOW_ALL_ORIGINS = True
SERVE_FRONTEND = os.environ.get("LP_DJANGO_DIRECT", "") == "1"
if os.environ.get("LP_DJANGO_MOCK"):
    INSTALLED_APPS = [*INSTALLED_APPS, "lp_twin_mock.LpTwinMockConfig"]  # noqa: F405
