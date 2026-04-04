import logging

from django.apps import AppConfig

logger = logging.getLogger(__name__)


class ApiConfig(AppConfig):
    name = "api"
    verbose_name = "LibrePhotos"

    def ready(self):
        from api.util import reconfigure_logging

        try:
            reconfigure_logging()
        except Exception:
            logger.warning(
                "Could not reconfigure logging from database settings; "
                "using defaults. This is expected during initial migration.",
                exc_info=True,
            )
