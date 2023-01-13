import pytz
from django.contrib.auth.models import AbstractUser
from django.db import models
from django_cryptography.fields import encrypt

import ownphotos.settings
from api.date_time_extractor import DEFAULT_RULES_JSON


def get_default_config_datetime_rules():  # This is a callable
    return DEFAULT_RULES_JSON


class User(AbstractUser):
    scan_directory = models.CharField(max_length=512, db_index=True)
    confidence = models.FloatField(default=0.1, db_index=True)
    confidence_person = models.FloatField(default=0.9)
    image_scale = models.FloatField(default=1)
    semantic_search_topk = models.IntegerField(default=0)
    avatar = models.ImageField(upload_to="avatars", null=True)
    transcode_videos = models.BooleanField(default=False)
    nextcloud_server_address = models.CharField(max_length=200, default=None, null=True)
    nextcloud_username = models.CharField(max_length=64, default=None, null=True)
    nextcloud_app_password = encrypt(
        models.CharField(max_length=64, default=None, null=True)
    )
    nextcloud_scan_directory = models.CharField(
        max_length=512, db_index=True, null=True
    )

    favorite_min_rating = models.IntegerField(
        default=ownphotos.settings.DEFAULT_FAVORITE_MIN_RATING, db_index=True
    )

    SaveMetadataToDisk = models.TextChoices(
        "SaveMetadataToDisk", "OFF MEDIA_FILE SIDECAR_FILE"
    )
    save_metadata_to_disk = models.TextField(
        choices=SaveMetadataToDisk.choices, default=SaveMetadataToDisk.OFF
    )

    datetime_rules = models.JSONField(default=get_default_config_datetime_rules)
    default_timezone = models.TextField(
        choices=[(x, x) for x in pytz.all_timezones],
        default="UTC",
    )
    public_sharing = models.BooleanField(default=False)


def get_admin_user():
    return User.objects.get(is_superuser=True)


def get_deleted_user():
    deleted_user: User = User.objects.get_or_create(username="deleted")[0]
    if deleted_user.is_active is not False:
        deleted_user.is_active = False
        deleted_user.save()
    return deleted_user
