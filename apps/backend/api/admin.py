from collections import defaultdict

from django.contrib import admin
from django_q.tasks import AsyncTask

from api.util import FACE_OVERLAP_IOU_THRESHOLD, calculate_iou
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
    User,
    Thumbnail,
)


# Photo ids are handed to django_q, which pickles them into the broker
# payload, so a selection is split into chunks of this size to keep any
# single payload small.
DEDUPLICATE_FACES_CHUNK_SIZE = 500


def deduplicate_faces_function(photo_ids):
    faces_by_photo = defaultdict(list)
    # `encoding` holds a face vector per row, so it is deliberately left out.
    for face in (
        Face.objects.filter(photo_id__in=photo_ids)
        .only(
            "photo_id",
            "person_id",
            "location_top",
            "location_bottom",
            "location_left",
            "location_right",
        )
        .order_by("id")
    ):
        faces_by_photo[face.photo_id].append(face)

    to_delete = set()
    for faces in faces_by_photo.values():
        for i, face_a in enumerate(faces):
            if face_a.id in to_delete:
                continue
            for face_b in faces[i + 1 :]:
                if face_b.id in to_delete:
                    continue
                iou = calculate_iou(
                    face_a.location_top,
                    face_a.location_right,
                    face_a.location_bottom,
                    face_a.location_left,
                    face_b.location_top,
                    face_b.location_right,
                    face_b.location_bottom,
                    face_b.location_left,
                )
                if iou >= FACE_OVERLAP_IOU_THRESHOLD:
                    # Keep the face that has a person label; if both or
                    # neither have one, keep the first.
                    if face_b.person_id and not face_a.person_id:
                        to_delete.add(face_a.id)
                        break  # face_a is going away, skip its remaining comparisons
                    else:
                        to_delete.add(face_b.id)

    if to_delete:
        Face.objects.filter(id__in=to_delete).delete()


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
    def deduplicate_faces(self, request, queryset):
        # Only the ids travel to the worker. Passing the queryset itself would
        # make django_q pickle every selected row into the broker payload, in
        # this request thread, which defeats the point of the async task.
        photo_ids = list(queryset.values_list("id", flat=True))
        for start in range(0, len(photo_ids), DEDUPLICATE_FACES_CHUNK_SIZE):
            AsyncTask(
                deduplicate_faces_function,
                photo_ids[start : start + DEDUPLICATE_FACES_CHUNK_SIZE],
            ).run()
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
admin.site.register(LongRunningJob)
admin.site.register(File)
admin.site.register(User)
