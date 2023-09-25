import os

from django.core.wsgi import get_wsgi_application

environment = "production"
if os.environ.get("DEBUG", "0") == "1":
    environment = "development"

os.environ.setdefault("DJANGO_SETTINGS_MODULE", f"librephotos.settings.{environment}")

application = get_wsgi_application()
