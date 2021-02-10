from datetime import datetime

from api.models.album_auto import AlbumAuto
from api.models.album_date import AlbumDate
from api.models.album_place import AlbumPlace
from api.models.album_thing import AlbumThing
from api.models.album_user import AlbumUser
from api.models.face import Face
from api.models.person import Person
from api.models.photo import Photo
from django.core.cache import cache
from django.db.models.signals import post_delete, post_save

# import PIL
# from PIL import ImageOps
# from django.db import models
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
# 
# from collections import Counter
# from io import BytesIO
# from django.core.files.base import ContentFile
# from geopy.geocoders import Nominatim
# from django.contrib.auth.models import AbstractUser

# from django.contrib.postgres.fields import JSONField


# from api.places365.places365 import inference_places365
# from api.im2txt.sample import im2txt
# 
# from django_cryptography.fields import encrypt
# from api.im2vec import Im2Vec

def change_api_updated_at(sender=None, instance=None, *args, **kwargs):
    cache.set('api_updated_at_timestamp', datetime.utcnow())

# for cache invalidation. invalidates all cache on modelviewsets on delete and save on any model
for model in [
        Photo, Person, Face, AlbumDate, AlbumAuto, AlbumUser, AlbumPlace,
        AlbumThing
]:
    post_save.connect(receiver=change_api_updated_at, sender=model)
    post_delete.connect(receiver=change_api_updated_at, sender=model)
