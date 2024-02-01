import pytz
from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.db import models
from django_cryptography.fields import encrypt

from api.date_time_extractor import DEFAULT_RULES_JSON


def get_default_config_datetime_rules():  # This is a callable
    return DEFAULT_RULES_JSON


def get_default_llm_settings():
    return {
        "enabled": False,
        "add_person": False,
        "add_location": False,
        "add_keywords": False,
        "add_camera": False,
        "add_lens": False,
        "add_album": False,
        "sentiment": 0,
        "custom_prompt": "",
        "custom_prompt_enabled": False,
    }


class User(AbstractUser):
    scan_directory = models.CharField(max_length=512, db_index=True)
    confidence = models.FloatField(default=0.1, db_index=True)
    confidence_person = models.FloatField(default=0.9)
    image_scale = models.FloatField(default=1)
    semantic_search_topk = models.IntegerField(default=0)
    avatar = models.ImageField(upload_to="avatars", null=True, blank=True)
    transcode_videos = models.BooleanField(default=False)
    nextcloud_server_address = models.CharField(
        max_length=200, default=None, null=True, blank=True
    )
    nextcloud_username = models.CharField(
        max_length=64, default=None, null=True, blank=True
    )
    nextcloud_app_password = encrypt(
        models.CharField(max_length=64, default=None, null=True, blank=True)
    )
    nextcloud_scan_directory = models.CharField(
        max_length=512, db_index=True, null=True, blank=True
    )

    favorite_min_rating = models.IntegerField(
        default=settings.DEFAULT_FAVORITE_MIN_RATING, db_index=True
    )

    class SaveMetadata(models.TextChoices):
        OFF = "OFF"
        MEDIA_FILE = "MEDIA_FILE"
        SIDECAR_FILE = "SIDECAR_FILE"

    save_metadata_to_disk = models.TextField(
        choices=SaveMetadata.choices, default=SaveMetadata.OFF
    )
    llm_settings = models.JSONField(default=get_default_llm_settings)
    datetime_rules = models.JSONField(default=get_default_config_datetime_rules)
    default_timezone = models.TextField(
        choices=[(x, x) for x in pytz.all_timezones],
        default="UTC",
    )
    public_sharing = models.BooleanField(default=False)

    class FaceRecogniton(models.TextChoices):
        HOG = "HOG"
        CNN = "CNN"

    face_recognition_model = models.TextField(
        choices=FaceRecogniton.choices, default=FaceRecogniton.HOG
    )
    min_cluster_size = models.IntegerField(default=0)
    confidence_unknown_face = models.FloatField(default=0.5)
    min_samples = models.IntegerField(default=1)
    cluster_selection_epsilon = models.FloatField(default=0.05)


def get_admin_user():
    return User.objects.get(is_superuser=True)


def get_deleted_user():
    deleted_user: User = User.objects.get_or_create(username="deleted")[0]
    if deleted_user.is_active is not False:
        deleted_user.is_active = False
        deleted_user.save()
    return deleted_user
