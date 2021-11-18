from django.apps import AppConfig
from django_rq import job


class ApiConfig(AppConfig):
    name = "api"
    verbose_name = "LibrePhotos"

    def ready(self):
        build_index.delay()


@job
def build_index():
    from api.image_similarity import build_image_similarity_index
    from api.models import User

    for user in User.objects.all():
        build_image_similarity_index(user)
