import datetime

import pytz
from django.db import models
from django.db.models import Prefetch

from api.models.photo import Photo
from api.models.user import User, get_deleted_user

utc = pytz.UTC


class Person(models.Model):
    KIND_CHOICES = (
        ("USER", "User Labelled"),
        ("CLUSTER", "Cluster ID"),
        ("UNKNOWN", "Unknown Person"),
    )
    name = models.CharField(blank=False, max_length=128)
    kind = models.CharField(choices=KIND_CHOICES, max_length=10)
    mean_face_encoding = models.TextField()
    cluster_id = models.IntegerField(null=True)
    account = models.OneToOneField(
        User, on_delete=models.SET(get_deleted_user), default=None, null=True
    )

    def __str__(self):
        return "%d" % self.id

    def get_photos(self, owner):
        faces = list(
            self.faces.prefetch_related(
                Prefetch(
                    "photo",
                    queryset=Photo.objects.exclude(image_hash=None)
                    .filter(hidden=False, owner=owner)
                    .order_by("-exif_timestamp")
                    .only(
                        "image_hash",
                        "exif_timestamp",
                        "rating",
                        "owner__id",
                        "public",
                        "hidden",
                    )
                    .prefetch_related("owner"),
                )
            )
        )

        photos = [face.photo for face in faces if hasattr(face.photo, "owner")]
        photos.sort(
            key=lambda x: x.exif_timestamp or utc.localize(datetime.datetime.min),
            reverse=True,
        )
        return photos


def get_unknown_person():
    return Person.objects.get_or_create(name="unknown")[0]


def get_or_create_person(name):
    return Person.objects.get_or_create(name=name)[0]
