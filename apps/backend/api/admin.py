from django.contrib import admin
from django.db.models import QuerySet
from django.http import HttpRequest

from api.faces.deduplicate import (
    DEDUPLICATE_FACES_CHUNK_SIZE,
    deduplicate_faces_of_photos,
)
from api.jobs.queue import enqueue_task

from .models import (
    AlbumAuto,
    AlbumDate,
    AlbumPlace,
    AlbumThing,
    AlbumUser,
    Cluster,
    Face,
    File,
    LongRunningJob,
    Person,
    Photo,
    Thumbnail,
    User,
)


@admin.register(Face)
class FaceAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "cluster_person",
        "cluster_probability",
        "classification_person",
        "cluster",
        "photo",
        "person",
    )
    list_filter = ("person", "cluster")


@admin.register(Photo)
class PhotoAdmin(admin.ModelAdmin):
    actions = ["deduplicate_faces"]
    list_display = [
        "image_hash",
        "owner",
        "main_file",
        "last_modified",
        "added_on",
        "size",
    ]
    list_filter = ["owner"]

    @admin.action(description="Deduplicate faces")
    def deduplicate_faces(
        self, request: HttpRequest, queryset: QuerySet[Photo]
    ) -> None:
        # Only the ids travel to the worker, in chunks. Passing the queryset
        # itself would make django_q pickle every selected row into the broker
        # payload, in this request thread, which defeats the point of the
        # async task.
        photo_ids = list(queryset.values_list("id", flat=True))
        for start in range(0, len(photo_ids), DEDUPLICATE_FACES_CHUNK_SIZE):
            enqueue_task(
                deduplicate_faces_of_photos,
                photo_ids[start : start + DEDUPLICATE_FACES_CHUNK_SIZE],
            )
        self.message_user(
            request,
            f"Queued face deduplication for {len(photo_ids)} photo(s).",
        )


@admin.register(Thumbnail)
class ThumbnailAdmin(admin.ModelAdmin):
    list_display = ["photo", "aspect_ratio"]
    raw_id_fields = ["photo"]


admin.site.register(Person)
admin.site.register(AlbumAuto)
admin.site.register(AlbumUser)
admin.site.register(AlbumThing)
admin.site.register(AlbumDate)
admin.site.register(AlbumPlace)
admin.site.register(Cluster)


@admin.register(LongRunningJob)
class LongRunningJobAdmin(admin.ModelAdmin):
    """A read-only job log: workers write job rows, and a change form would save
    the whole row, undoing a cancel (``LongRunningJob.save`` refuses that)."""

    list_display = ["job_id", "job_type", "started_by", "queued_at", "finished"]
    list_filter = ["job_type", "finished", "failed", "cancelled"]

    def has_add_permission(self, request: HttpRequest) -> bool:
        return False

    def has_change_permission(
        self, request: HttpRequest, obj: LongRunningJob | None = None
    ) -> bool:
        return False


admin.site.register(File)
admin.site.register(User)
