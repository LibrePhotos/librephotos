# from datetime import datetime
# import PIL
# from PIL import ImageOps
from collections import Counter
from io import BytesIO

# from api.im2txt.sample import im2txt
# from api.im2vec import Im2Vec
from api.models.person import Person, get_unknown_person
from api.models.photo import Photo
# from api.models.user import User
# from api.places365.places365 import inference_places365
# from django.contrib.auth.models import AbstractUser
# from django.contrib.postgres.fields import JSONField
# from django.core.cache import cache
# from django.core.files.base import ContentFile
from django.db import models

# from django.db.models.signals import post_delete, post_save
# from django_cryptography.fields import encrypt
# from geopy.geocoders import Nominatim

# from django.db.models import Prefetch
# import face_recognition
# import hashlib
# import ownphotos.settings
# import api.util as util
# from api.util import logger
# import exifread
# import base64
# import numpy as np
# import os
# import pytz
# import pyheif
# import magic
# 
# from api.exifreader import rotate_image


class Face(models.Model):
    photo = models.ForeignKey(
        Photo,
        related_name='faces',
        on_delete=models.SET(get_unknown_person),
        blank=False,
        null=True)
    image = models.ImageField(upload_to='faces')
    image_path = models.FilePathField()

    person = models.ForeignKey(
        Person, on_delete=models.SET(get_unknown_person), related_name='faces')
    person_label_is_inferred = models.NullBooleanField(db_index=True)
    person_label_probability = models.FloatField(default=0., db_index=True)

    location_top = models.IntegerField()
    location_bottom = models.IntegerField()
    location_left = models.IntegerField()
    location_right = models.IntegerField()

    encoding = models.TextField()

    def __str__(self):
        return "%d" % self.id
