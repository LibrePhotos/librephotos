from typing import Any

from django.core.management.base import BaseCommand

from api.jobs.queue import enqueue_task
from api.models import User
from api.search.embedding_jobs import queue_semantic_search_conversion
from api.search.similarity import build_image_similarity_index


class Command(BaseCommand):
    help = (
        "Build image similarity index for all users; re-embed the photos of "
        "users whose embeddings come from another semantic search model"
    )

    def handle(self, *args: Any, **kwargs: Any) -> None:
        converting = set(queue_semantic_search_conversion())
        for user in User.objects.exclude(pk__in=converting):
            enqueue_task(build_image_similarity_index, user)
