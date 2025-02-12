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
            "save_metadata_to_disk",
            "datetime_rules",
            "llm_settings",
            "default_timezone",
            "public_sharing",
            "face_recognition_model",
            "min_cluster_size",
            "confidence_unknown_face",
            "min_samples",
            "cluster_selection_epsilon",
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
            if is_superuser:
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
            password = validated_data.pop("password")
            if password != "":
                instance.set_password(password)
        if "avatar" in validated_data:
            instance.avatar = validated_data.pop("avatar")
            instance.save()
        if "email" in validated_data:
            instance.email = validated_data.pop("email")
            instance.save()
        if "first_name" in validated_data:
            instance.first_name = validated_data.pop("first_name")
            instance.save()
        if "last_name" in validated_data:
            instance.last_name = validated_data.pop("last_name")
            instance.save()
        if "transcode_videos" in validated_data:
            instance.transcode_videos = validated_data.pop("transcode_videos")
            instance.save()
        if "nextcloud_server_address" in validated_data:
            instance.nextcloud_server_address = validated_data.pop(
                "nextcloud_server_address"
            )
            instance.save()
        if "nextcloud_username" in validated_data:
            instance.nextcloud_username = validated_data.pop("nextcloud_username")
            instance.save()
        if "nextcloud_app_password" in validated_data:
            instance.nextcloud_app_password = validated_data.pop(
                "nextcloud_app_password"
            )
            instance.save()
        if "nextcloud_scan_directory" in validated_data:
            instance.nextcloud_scan_directory = validated_data.pop(
                "nextcloud_scan_directory"
            )
            instance.save()
        if "confidence" in validated_data:
            instance.confidence = validated_data.pop("confidence")
            instance.save()
            logger.info(f"Updated confidence for user {instance.confidence}")
        if "confidence_person" in validated_data:
            instance.confidence_person = validated_data.pop("confidence_person")
            instance.save()
            logger.info(
                f"Updated person album confidence for user {instance.confidence_person}"
            )
        if "semantic_search_topk" in validated_data:
            new_semantic_search_topk = validated_data.pop("semantic_search_topk")

            if instance.semantic_search_topk == 0 and new_semantic_search_topk > 0:
                chain = Chain()
                if not do_all_models_exist():
                    chain.append(download_models, User.objects.get(id=instance.id))
                chain.append(
                    batch_calculate_clip_embedding, User.objects.get(id=instance.id)
                )
                chain.run()

            instance.semantic_search_topk = new_semantic_search_topk
            instance.save()
            logger.info(
                f"Updated semantic_search_topk for user {instance.semantic_search_topk}"
            )
        if "favorite_min_rating" in validated_data:
            new_favorite_min_rating = validated_data.pop("favorite_min_rating")
            instance.favorite_min_rating = new_favorite_min_rating
            instance.save()
            logger.info(
                f"Updated favorite_min_rating for user {instance.favorite_min_rating}"
            )
        if "save_metadata_to_disk" in validated_data:
            instance.save_metadata_to_disk = validated_data.pop("save_metadata_to_disk")
            instance.save()
            logger.info(
                f"Updated save_metadata_to_disk for user {instance.save_metadata_to_disk}"
            )
        if "image_scale" in validated_data:
            new_image_scale = validated_data.pop("image_scale")
            instance.image_scale = new_image_scale
            instance.save()
            logger.info(f"Updated image_scale for user {instance.image_scale}")
        if "datetime_rules" in validated_data:
            new_datetime_rules = validated_data.pop("datetime_rules")
            instance.datetime_rules = new_datetime_rules
            instance.save()
            logger.info(f"Updated datetime_rules for user {instance.datetime_rules}")
        if "default_timezone" in validated_data:
            new_default_timezone = validated_data.pop("default_timezone")
            instance.default_timezone = new_default_timezone
            instance.save()
            logger.info(
                f"Updated default_timezone for user {instance.default_timezone}"
            )
        if "public_sharing" in validated_data:
            instance.public_sharing = validated_data.pop("public_sharing")
            instance.save()
        if "face_recognition_model" in validated_data:
            instance.face_recognition_model = validated_data.pop(
                "face_recognition_model"
            )
            instance.save()
        if "min_cluster_size" in validated_data:
            instance.min_cluster_size = validated_data.pop("min_cluster_size")
            instance.save()
        if "confidence_unknown_face" in validated_data:
            instance.confidence_unknown_face = validated_data.pop(
                "confidence_unknown_face"
            )
            instance.save()
        if "min_samples" in validated_data:
            instance.min_samples = validated_data.pop("min_samples")
            instance.save()
        if "cluster_selection_epsilon" in validated_data:
            instance.cluster_selection_epsilon = validated_data.pop(
                "cluster_selection_epsilon"
            )
            instance.save()
        if "llm_settings" in validated_data:
            instance.llm_settings = validated_data.pop("llm_settings")
            instance.save()

        return instance

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
        fields = (
            "id",
            "avatar_url",
            "username",
            "first_name",
            "last_name",
            "public_photo_count",
            "public_photo_samples",
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
        should_be_superuser = User.objects.filter(is_superuser=True).count() == 0
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
        }

    def get_photo_count(self, obj) -> int:
        return Photo.objects.filter(owner=obj).count()

    def update(self, instance: User, validated_data):
        if "password" in validated_data:
            password = validated_data.pop("password")
            if password != "":
                instance.set_password(password)

        if "scan_directory" in validated_data:
            new_scan_directory = validated_data.pop("scan_directory")

            if new_scan_directory:  # Ensure it's not an empty string
                abs_new_scan_directory = os.path.abspath(new_scan_directory)

                if not is_valid_path(abs_new_scan_directory, settings.DATA_ROOT):
                    raise ValidationError(
                        "Scan directory must be inside the data root."
                    )

                if os.path.exists(abs_new_scan_directory):
                    instance.scan_directory = abs_new_scan_directory
                    logger.info(
                        f"Updated scan directory for user {instance.scan_directory}"
                    )
                else:
                    raise ValidationError("Scan directory does not exist")
        if "username" in validated_data:
            username = validated_data.pop("username")
            if username != "":
                other_user = User.objects.filter(username=username).first()
                if other_user is not None and other_user != instance:
                    raise ValidationError("User name is already taken")

            instance.username = username

        if "email" in validated_data:
            email = validated_data.pop("email")
            instance.email = email

        if "first_name" in validated_data:
            first_name = validated_data.pop("first_name")
            instance.first_name = first_name

        if "last_name" in validated_data:
            last_name = validated_data.pop("last_name")
            instance.last_name = last_name

        instance.save()
        return instance
