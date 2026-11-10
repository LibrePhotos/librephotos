from importlib.util import find_spec

from librephotos.logging_bootstrap import defer_warning

from .production import *  # noqa

DEBUG = True

# The development tools come from requirements.dev.txt, which only the DEBUG=1
# image build installs. A production image started with DEBUG=1 runs these
# settings too, so each tool is added only when it is installed.
if find_spec("silk") is not None:
    MIDDLEWARE += ["silk.middleware.SilkyMiddleware"]  # noqa
    INSTALLED_APPS += ["silk"]  # noqa
else:
    defer_warning("django-silk is not installed (requirements.dev.txt): no /api/silk")
if find_spec("django_extensions") is not None:
    INSTALLED_APPS += ["django_extensions"]  # noqa
