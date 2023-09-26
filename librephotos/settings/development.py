from .production import *  # noqa

DEBUG = True
MIDDLEWARE += ["silk.middleware.SilkyMiddleware"]  # noqa
INSTALLED_APPS += ["silk"]  # noqa
INSTALLED_APPS += ["drf_spectacular"]
SPECTACULAR_SETTINGS = {
    "TITLE": "LibrePhotos",
    "DESCRIPTION": "Your project description",
    "VERSION": "1.0.0",
}
