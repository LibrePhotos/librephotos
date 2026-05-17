from django.apps import AppConfig

from django_q.conf import Conf


class DjangoQConfig(AppConfig):
    name = "django_q"
    verbose_name = Conf.LABEL
    default_auto_field = "django.db.models.AutoField"

    def ready(self):
        from django_q.signals import call_hook  # noqa: F401
