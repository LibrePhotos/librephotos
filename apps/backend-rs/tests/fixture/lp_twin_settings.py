"""Django settings for the reference server and the fixture build.

Production settings on PostgreSQL, reachable on any host name. With
LP_DJANGO_DIRECT=1 Django streams media itself (SERVE_FRONTEND) instead of
answering with an empty X-Accel-Redirect body for nginx.
"""

import os

from librephotos.settings.production import *  # noqa: F403

ALLOWED_HOSTS = ["*"]
CORS_ALLOW_ALL_ORIGINS = True
SERVE_FRONTEND = os.environ.get("LP_DJANGO_DIRECT", "") == "1"
