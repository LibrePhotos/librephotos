import datetime

import pytz
from django.db import models
from django.db.models import Prefetch

from api.models.photo import Photo
from api.models.user import User, get_deleted_user

utc = pytz.UTC


class Person(models.Model):
    UNKNOWN_PERSON_NAME = "Unknown - Other"
    KIND_USER = "USER"
    KIND_CLUSTER = "CLUSTER"
    KIND_UNKNOWN = "UNKNOWN"
    KIND_CHOICES = (
        (KIND_USER, "User Labelled"),
        (KIND_CLUSTER, "Cluster ID"),
        (KIND_UNKNOWN, "Unknown Person"),
    )
    name = models.CharField(blank=False, max_length=128)
    kind = models.CharField(choices=KIND_CHOICES, max_length=10)
    account = models.OneToOneField(
        User, on_delete=models.SET(get_deleted_user), default=None, null=True
    )
    cover_photo = models.ForeignKey(
        Photo, related_name="person", on_delete=models.PROTECT, blank=False, null=True
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
    unknown_person: Person = Person.objects.get_or_create(name=Person.UNKNOWN_PERSON_NAME)[0]
    if unknown_person.kind != Person.KIND_UNKNOWN:
        unknown_person.kind = Person.KIND_UNKNOWN
        unknown_person.save()
    return unknown_person


def get_or_create_person(name):
    return Person.objects.get_or_create(name=name)[0]
