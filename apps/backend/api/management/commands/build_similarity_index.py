from django.core.management.base import BaseCommand
from django_q.tasks import AsyncTask

from api.batch_jobs import queue_semantic_search_conversion
from api.image_similarity import build_image_similarity_index
from api.models import User


class Command(BaseCommand):
    help = (
        "Build image similarity index for all users; re-embed the photos of "
        "users whose embeddings come from another semantic search model"
    )

    def handle(self, *args, **kwargs):
        converting = set(queue_semantic_search_conversion())
        for user in User.objects.exclude(pk__in=converting):
            AsyncTask(build_image_similarity_index, user).run()
