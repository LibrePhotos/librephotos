import base64

# import api.util as util
# import exifread
# import face_recognition
# import magic
import numpy as np
# import ownphotos.settings
# import PIL
# import pyheif
# import pytz
# from api.exifreader import rotate_image
# from api.im2txt.sample import im2txt
from api.models.photo import Photo
from api.models.user import User, get_deleted_user
# from api.places365.places365 import inference_places365
from api.util import logger
# from django.contrib.auth.models import AbstractUser
# from django.contrib.postgres.fields import JSONField
# from django.core.cache import cache
# from django.core.files.base import ContentFile
from django.db import models
from django.db.models import Prefetch
from django.db.models.signals import post_delete, post_save

# import hashlib
# import os
# from collections import Counter
# from datetime import datetime
# from io import BytesIO

# from django_cryptography.fields import encrypt
# from geopy.geocoders import Nominatim
# from PIL import ImageOps


class Person(models.Model):
    KIND_CHOICES = (('USER', 'User Labelled'), ('CLUSTER', 'Cluster ID'),
                    ('UNKNOWN', 'Unknown Person'))
    name = models.CharField(blank=False, max_length=128)
    kind = models.CharField(choices=KIND_CHOICES, max_length=10)
    mean_face_encoding = models.TextField()
    cluster_id = models.IntegerField(null=True)
    account = models.OneToOneField(
        User, on_delete=models.SET(get_deleted_user), default=None, null=True)

    def __str__(self):
        return "%d" % self.id

    def _update_average_face_encoding(self):
        encodings = []
        faces = self.faces.all()
        for face in faces:
            r = base64.b64decode(face.encoding)
            encoding = np.frombuffer(r, dtype=np.float64)
            encodings.append(encoding)
        mean_encoding = np.array(encodings).mean(axis=0)
        self.mean_face_encoding = base64.encodebytes(mean_encoding.tostring())

    def get_photos(self, owner):
        faces = list(
            self.faces.prefetch_related(
                Prefetch(
                    'photo',
                    queryset=Photo.objects.exclude(image_hash=None).filter(hidden=False,
                        owner=owner).order_by('-exif_timestamp').only(
                            'image_hash', 'exif_timestamp', 'favorited',
                            'owner__id', 'public',
                            'hidden').prefetch_related('owner'))))

        photos = [face.photo for face in faces if hasattr(face.photo, 'owner')]
        return photos

def get_unknown_person():
    return Person.objects.get_or_create(name='unknown')[0]

def get_or_create_person(name):
    return Person.objects.get_or_create(name=name)[0]

