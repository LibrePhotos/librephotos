from datetime import datetime
import PIL
from PIL import ImageOps
from django.db import models
from django.db.models import Prefetch
import face_recognition
import hashlib
import ownphotos.settings
import api.util as util
from api.util import logger
import exifread
import base64
import numpy as np
import os
import pytz
import pyheif
import magic

from api.exifreader import rotate_image

from collections import Counter
from io import BytesIO
from django.core.files.base import ContentFile
from geopy.geocoders import Nominatim
from django.contrib.auth.models import AbstractUser
from api.models.photo import Photo
from api.models.user import User, get_deleted_user

from django.db.models.signals import post_save, post_delete
from django.core.cache import cache
from django.contrib.postgres.fields import JSONField

from api.places365.places365 import inference_places365
from api.im2txt.sample import im2txt

from django_cryptography.fields import encrypt

class AlbumUser(models.Model):
    title = models.CharField(max_length=512)
    created_on = models.DateTimeField(auto_now=True, db_index=True)
    photos = models.ManyToManyField(Photo)
    favorited = models.BooleanField(default=False, db_index=True)
    owner = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None)

    shared_to = models.ManyToManyField(
        User, related_name='album_user_shared_to')

    public = models.BooleanField(default=False, db_index=True)

    class Meta:
        unique_together = ('title', 'owner')

    @property
    def cover_photos(self):
        return self.photos.filter(hidden=False)[:4]