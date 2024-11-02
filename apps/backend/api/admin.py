from django.contrib import admin
from django_q.tasks import AsyncTask

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
)


def deduplicate_faces_function(queryset):
    for photo in queryset:
        # Get all faces in the photo
        faces = Face.objects.filter(photo=photo)
        # Check if there are any faces which have similar bounding boxes
        for face in faces:
            margin = int((face.location_right - face.location_left) * 0.05)
            similar_faces = Face.objects.filter(
                photo=photo,
                location_top__lte=face.location_top + margin,
                location_top__gte=face.location_top - margin,
                location_right__lte=face.location_right + margin,
                location_right__gte=face.location_right - margin,
                location_bottom__lte=face.location_bottom + margin,
                location_bottom__gte=face.location_bottom - margin,
                location_left__lte=face.location_left + margin,
                location_left__gte=face.location_left - margin,
            )
            if len(similar_faces) > 1:
                # Divide between faces with a person label and faces without
                faces_with_person_label = []
                faces_without_person_label = []
                for similar_face in similar_faces:
                    if similar_face.person:
                        faces_with_person_label.append(similar_face)
                    else:
                        faces_without_person_label.append(similar_face)
                # If there are faces with a person label, keep the first one and delete the rest
                for similar_face in faces_with_person_label[1:]:
                    similar_face.delete()
                # If there are faces with a person label, delete all of them
                if len(faces_with_person_label) > 0:
                    for similar_face in faces_without_person_label:
                        similar_face.delete()
                # Otherwise, keep the first face and delete the rest
                else:
                    for similar_face in faces_without_person_label[1:]:
                        similar_face.delete()


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
        "aspect_ratio",
        "last_modified",
        "added_on",
        "width",
        "height",
    ]
    list_filter = ["owner"]

    def deduplicate_faces(self, request, queryset):
        AsyncTask(
            deduplicate_faces_function,
            queryset=queryset,
        ).run()


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
