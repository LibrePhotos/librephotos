from .production import *  # noqa

DEBUG = True
MIDDLEWARE += ["silk.middleware.SilkyMiddleware"]  # noqa
INSTALLED_APPS += ["silk"]  # noqa
