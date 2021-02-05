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

from django.db.models.signals import post_save, post_delete
from django.core.cache import cache
from django.contrib.postgres.fields import JSONField

from api.places365.places365 import inference_places365
from api.im2txt.sample import im2txt

from django_cryptography.fields import encrypt

class User(AbstractUser):
    scan_directory = models.CharField(max_length=512, db_index=True)
    confidence = models.FloatField(default=0.1, db_index=True)
    avatar = models.ImageField(upload_to='avatars', null=True)

    nextcloud_server_address = models.CharField(
        max_length=200, default=None, null=True)
    nextcloud_username = models.CharField(
        max_length=64, default=None, null=True)
    nextcloud_app_password = encrypt(
        models.CharField(max_length=64, default=None, null=True))
    nextcloud_scan_directory = models.CharField(
        max_length=512, db_index=True, null=True)

def get_admin_user():
    return User.objects.get(is_superuser=True)

def get_deleted_user():
    return User.objects.get_or_create(username='deleted')[0]