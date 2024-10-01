import os

import numpy as np
from django.db import models
from django.dispatch import receiver

from api.face_recognition import get_face_encodings
from api.models.cluster import Cluster
from api.models.person import Person
from api.models.photo import Photo


class Face(models.Model):
    photo = models.ForeignKey(
        Photo, related_name="faces", on_delete=models.CASCADE, blank=False, null=True
    )
    image = models.ImageField(upload_to="faces", null=True)

    person = models.ForeignKey(
        Person, on_delete=models.DO_NOTHING, related_name="faces", null=True
    )

    classification_person = models.ForeignKey(
        Person,
        related_name="classification_faces",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
    )
    classification_probability = models.FloatField(default=0.0, db_index=True)

    cluster_person = models.ForeignKey(
        Person,
        related_name="cluster_faces",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
    )
    cluster_probability = models.FloatField(default=0.0, db_index=True)

    deleted = models.BooleanField(default=False)

    cluster = models.ForeignKey(
        Cluster,
        related_name="faces",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
    )

    location_top = models.IntegerField()
    location_bottom = models.IntegerField()
    location_left = models.IntegerField()
    location_right = models.IntegerField()
    encoding = models.TextField()

    @property
    def timestamp(self):
        return self.photo.exif_timestamp if self.photo else None

    def __str__(self):
        return "%d" % self.id

    def generate_encoding(self):
        self.encoding = (
            get_face_encodings(
                self.photo.thumbnail_big.path,
                [
                    (
                        self.location_top,
                        self.location_right,
                        self.location_bottom,
                        self.location_left,
                    )
                ],
            )[0]
            .tobytes()
            .hex()
        )
        self.save()

    def get_encoding_array(self):
        return np.frombuffer(bytes.fromhex(self.encoding))


@receiver(models.signals.post_delete, sender=Person)
def reset_person(sender, instance, **kwargs):
    instance.faces.update(person=None)


# From: https://stackoverflow.com/questions/16041232/django-delete-filefield
@receiver(models.signals.post_delete, sender=Face)
def auto_delete_file_on_delete(sender, instance, **kwargs):
    if instance.image:
        if os.path.isfile(instance.image.path):
            os.remove(instance.image.path)
