
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

from api.models.user import User, get_deleted_user

def get_default_longrunningjob_result():
    return {'progress': {'target': 0, 'current': 0}}


class LongRunningJob(models.Model):
    JOB_SCAN_PHOTOS = 1
    JOB_GENERATE_AUTO_ALBUMS = 2
    JOB_GENERATE_AUTO_ALBUM_TITLES = 3
    JOB_TRAIN_FACES = 4
    JOB_TYPES = (
        (JOB_SCAN_PHOTOS, "Scan Photos"),
        (JOB_GENERATE_AUTO_ALBUMS, "Generate Event Albums"),
        (JOB_GENERATE_AUTO_ALBUM_TITLES, "Regenerate Event Titles"),
        (JOB_TRAIN_FACES, "Train Faces"),
    )

    job_type = models.PositiveIntegerField(choices=JOB_TYPES, )

    finished = models.BooleanField(default=False, blank=False, null=False)
    failed = models.BooleanField(default=False, blank=False, null=False)
    job_id = models.CharField(max_length=36, unique=True, db_index=True)
    queued_at = models.DateTimeField(default=datetime.now, null=False)
    started_at = models.DateTimeField(null=True)
    finished_at = models.DateTimeField(null=True)
    result = JSONField(
        default=get_default_longrunningjob_result, blank=False, null=False)
    started_by = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None)


