from django.apps import AppConfig


class ApiConfig(AppConfig):
    name = "api"
    verbose_name = "LibrePhotos"

    def ready(self):
        from api.util import reconfigure_logging

        try:
            reconfigure_logging()
        except Exception:
            pass
