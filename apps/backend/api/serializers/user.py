import os

from django.conf import settings
from django.contrib.auth import get_user_model
from django.db.models import Q
from django_q.tasks import Chain
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from api.batch_jobs import batch_calculate_clip_embedding
from api.ml_models import do_all_models_exist, download_models
from api.models import Photo, User
from api.serializers.simple import PhotoSuperSimpleSerializer
from api.util import is_valid_path, logger

# (field name, log message template) in the order the fields are applied.
USER_UPDATE_FIELDS = (
    ("avatar", None),
    ("email", None),
    ("first_name", None),
    ("last_name", None),
    ("transcode_videos", None),
    ("nextcloud_server_address", None),
    ("nextcloud_username", None),
    ("nextcloud_app_password", None),
    ("nextcloud_scan_directory", None),
    ("confidence", "Updated confidence for user {value}"),
    ("confidence_person", "Updated person album confidence for user {value}"),
    ("semantic_search_topk", "Updated semantic_search_topk for user {value}"),
    ("favorite_min_rating", "Updated favorite_min_rating for user {value}"),
    ("save_metadata_to_disk", "Updated save_metadata_to_disk for user {value}"),
    (
        "save_face_tags_to_disk",
        "Updated save_face_tags_to_disk to {value} for user {username}",
    ),
    ("image_scale", "Updated image_scale for user {value}"),
    ("text_alignment", "Updated text_alignment for user {value}"),
    ("header_size", "Updated header_size for user {value}"),
    ("datetime_rules", "Updated datetime_rules for user {value}"),
    ("default_timezone", "Updated default_timezone for user {value}"),
    ("public_sharing", None),
    ("min_cluster_size", None),
    ("confidence_unknown_face", None),
    ("min_samples", None),
    ("cluster_selection_epsilon", None),
    ("llm_settings", None),
    ("skip_raw_files", "Updated skip_raw_files to {value} for user {username}"),
    ("stack_raw_jpeg", "Updated stack_raw_jpeg to {value} for user {username}"),
    (
        "slideshow_interval",
        "Updated slideshow_interval to {value} for user {username}",
    ),
    (
        "duplicate_sensitivity",
        "Updated duplicate_sensitivity to {value} for user {username}",
    ),
    (
        "duplicate_clear_existing",
        "Updated duplicate_clear_existing to {value} for user {username}",
    ),
)


def set_password_if_allowed(instance, validated_data):
    password = validated_data.pop("password")
    if password != "" and not settings.DEMO_SITE:
        instance.set_password(password)


def assign_fields(instance, validated_data, fields):
    for field in fields:
        if field in validated_data:
            setattr(instance, field, validated_data.pop(field))


class UserSerializer(serializers.ModelSerializer):
    public_photo_count = serializers.SerializerMethodField()
    public_photo_samples = serializers.SerializerMethodField()
    photo_count = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = User
        extra_kwargs = {
            "password": {"write_only": True},
            "first_name": {"required": False},
            "last_name": {"required": False},
            "scan_directory": {"required": False},
            "confidence": {"required": False},
            "confidence_person": {"required": False},
            "semantic_search_topk": {"required": False},
            "nextcloud_server_address": {"required": False},
            "nextcloud_username": {"required": False},
            "nextcloud_scan_directory": {"required": False},
            "nextcloud_app_password": {"write_only": True},
            "favorite_min_rating": {"required": False},
            "save_metadata_to_disk": {"required": False},
            "save_face_tags_to_disk": {"required": False},
            "text_alignment": {"required": False},
            "header_size": {"required": False},
            "skip_raw_files": {"required": False},
            "stack_raw_jpeg": {"required": False},
            "slideshow_interval": {"required": False},
            "duplicate_sensitivity": {"required": False},
            "duplicate_clear_existing": {"required": False},
        }
        fields = (
            "id",
            "username",
            "email",
            "scan_directory",
            "confidence",
            "confidence_person",
            "transcode_videos",
            "semantic_search_topk",
            "first_name",
            "public_photo_samples",
            "last_name",
            "public_photo_count",
            "date_joined",
            "password",
            "avatar",
            "is_superuser",
            "photo_count",
            "nextcloud_server_address",
            "nextcloud_username",
            "nextcloud_app_password",
            "nextcloud_scan_directory",
            "avatar_url",
            "favorite_min_rating",
            "image_scale",
            "text_alignment",
            "header_size",
            "save_metadata_to_disk",
            "save_face_tags_to_disk",
            "datetime_rules",
            "burst_detection_rules",
            "llm_settings",
            "default_timezone",
            "public_sharing",
            "public_sharing_defaults",
            "min_cluster_size",
            "confidence_unknown_face",
            "min_samples",
            "cluster_selection_epsilon",
            "skip_raw_files",
            "stack_raw_jpeg",
            "slideshow_interval",
            "duplicate_sensitivity",
            "duplicate_clear_existing",
        )

    def validate_nextcloud_app_password(self, value):
        return value

    def create(self, validated_data):
        if "scan_directory" in validated_data.keys():
            if (
                not self.context["request"].user.is_superuser
                or validated_data["scan_directory"] == "initial"
            ):
                validated_data.pop("scan_directory")
        # make sure username is always lowercase
        if "username" in validated_data.keys():
            validated_data["username"] = validated_data["username"].lower()
        if "is_superuser" in validated_data.keys():
            is_superuser = validated_data.pop("is_superuser")
            if (
                is_superuser
                and self.context["request"].user.is_authenticated
                and self.context["request"].user.is_superuser
            ):
                user = User.objects.create_superuser(**validated_data)
            else:
                user = User.objects.create_user(**validated_data)
        else:
            user = User.objects.create_user(**validated_data)
        logger.info(f"Created user {user.id}")
        return user

    def update(self, instance, validated_data):
        # user can only update the following
        if "password" in validated_data:
            set_password_if_allowed(instance, validated_data)
        for field, log_message in USER_UPDATE_FIELDS:
            if field not in validated_data:
                continue
            value = validated_data.pop(field)
            if field == "semantic_search_topk":
                self.queue_semantic_search_jobs(instance, value)
            setattr(instance, field, value)
            instance.save()
            if log_message:
                logger.info(log_message.format(value=value, username=instance.username))

        return instance

    def queue_semantic_search_jobs(self, instance, new_semantic_search_topk):
        if instance.semantic_search_topk != 0 or new_semantic_search_topk <= 0:
            return
        chain = Chain()
        if not do_all_models_exist():
            chain.append(download_models, User.objects.get(id=instance.id))
        chain.append(batch_calculate_clip_embedding, User.objects.get(id=instance.id))
        chain.run()

    def get_photo_count(self, obj) -> int:
        return Photo.objects.filter(owner=obj).count()

    def get_public_photo_count(self, obj) -> int:
        return Photo.objects.filter(Q(owner=obj) & Q(public=True)).count()

    def get_public_photo_samples(self, obj) -> PhotoSuperSimpleSerializer(many=True):
        return PhotoSuperSimpleSerializer(
            Photo.objects.filter(Q(owner=obj) & Q(public=True))[:10], many=True
        ).data

    def get_avatar_url(self, obj) -> str or None:
        try:
            return obj.avatar.url
        except Exception:
            return None


class PublicUserSerializer(serializers.ModelSerializer):
    public_photo_count = serializers.SerializerMethodField()
    public_photo_samples = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()

    class Meta:
        model = User
        # Public-safe fields only -- never expose private profile data here
        # (email, scan_directory, Nextcloud creds, is_superuser, ...). See #1861.
        # public_sharing is included because it is not private (it is the basis
        # of the public-user discovery page) and the frontend needs it to list
        # users who opted into public sharing.
        fields = (
            "id",
            "avatar_url",
            "username",
            "first_name",
            "last_name",
            "public_photo_count",
            "public_photo_samples",
            "public_sharing",
        )

    def get_public_photo_count(self, obj) -> int:
        return Photo.objects.filter(Q(owner=obj) & Q(public=True)).count()

    def get_public_photo_samples(self, obj) -> PhotoSuperSimpleSerializer(many=True):
        return PhotoSuperSimpleSerializer(
            Photo.objects.filter(Q(owner=obj) & Q(public=True))[:10], many=True
        ).data

    def get_avatar_url(self, obj) -> str or None:
        try:
            return obj.avatar.url
        except ValueError:
            return None


class SignupUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        extra_kwargs = {
            "username": {"required": True},
            "password": {
                "write_only": True,
                "required": True,
                "min_length": 3,  # configurable min password length?
            },
            "email": {"required": True},
            "first_name": {"required": True},
            "last_name": {"required": True},
            "is_superuser": {"write_only": True},
        }
        fields = (
            "username",
            "password",
            "email",
            "first_name",
            "last_name",
            "is_superuser",
        )

    def create(self, validated_data):
        should_be_superuser = not User.objects.filter(is_superuser=True).exists()
        user = super().create(validated_data)
        user.set_password(validated_data.pop("password"))
        user.is_staff = should_be_superuser
        user.is_superuser = should_be_superuser
        user.save()
        return user


class DeleteUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = get_user_model()
        fields = "__all__"


class ManageUserSerializer(serializers.ModelSerializer):
    photo_count = serializers.SerializerMethodField()

    class Meta:
        model = get_user_model()
        fields = (
            "username",
            "scan_directory",
            "skip_raw_files",
            "stack_raw_jpeg",
            "confidence",
            "semantic_search_topk",
            "last_login",
            "date_joined",
            "photo_count",
            "id",
            "favorite_min_rating",
            "image_scale",
            "save_metadata_to_disk",
            "email",
            "first_name",
            "last_name",
            "password",
        )
        extra_kwargs = {
            "password": {"write_only": True},
            "scan_directory": {"required": False},
            "skip_raw_files": {"required": False},
            "stack_raw_jpeg": {"required": False},
        }

    def get_photo_count(self, obj) -> int:
        return Photo.objects.filter(owner=obj).count()

    def update(self, instance: User, validated_data):
        if "password" in validated_data:
            set_password_if_allowed(instance, validated_data)

        if "scan_directory" in validated_data:
            self.apply_scan_directory(instance, validated_data.pop("scan_directory"))

        assign_fields(instance, validated_data, ("skip_raw_files", "stack_raw_jpeg"))

        if "username" in validated_data:
            self.apply_username(instance, validated_data.pop("username"))

        assign_fields(instance, validated_data, ("email", "first_name", "last_name"))

        instance.save()
        return instance

    def apply_scan_directory(self, instance: User, new_scan_directory):
        if not new_scan_directory:  # Ensure it's not an empty string
            return

        abs_new_scan_directory = os.path.abspath(new_scan_directory)

        if not is_valid_path(abs_new_scan_directory, settings.DATA_ROOT):
            raise ValidationError("Scan directory must be inside the data root.")

        if not os.path.exists(abs_new_scan_directory):
            raise ValidationError("Scan directory does not exist")

        instance.scan_directory = abs_new_scan_directory
        logger.info(f"Updated scan directory for user {instance.scan_directory}")

    def apply_username(self, instance: User, username):
        if username != "":
            other_user = User.objects.filter(username=username).first()
            if other_user is not None and other_user != instance:
                raise ValidationError("User name is already taken")

        instance.username = username
