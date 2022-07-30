import os

import serpy
from django.contrib.auth import get_user_model
from django.core.cache import cache
from django.db.models import Q
from rest_framework import serializers
from rest_framework.exceptions import ValidationError

from api.batch_jobs import create_batch_job
from api.models import LongRunningJob, Photo, User
from api.models.user import get_deleted_user
from api.serializers.photos import PhotoSuperSimpleSerializer
from api.util import logger


class SimpleUserSerializerSerpy(serpy.Serializer):
    id = serpy.IntField()
    username = serpy.StrField()
    first_name = serpy.StrField()
    last_name = serpy.StrField()


class SimpleUserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = (
            "id",
            "username",
            "first_name",
            "last_name",
        )


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
            "default_timezone",
        )

    def validate_nextcloud_app_password(self, value):
        return value

    def create(self, validated_data):
        if "scan_directory" in validated_data.keys():
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
        logger.info("Created user {}".format(user.id))
        cache.clear()
        return user

    def update(self, instance, validated_data):
        # user can only update the following
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
            logger.info("Updated confidence for user {}".format(instance.confidence))
        if "semantic_search_topk" in validated_data:
            new_semantic_search_topk = validated_data.pop("semantic_search_topk")

            if instance.semantic_search_topk == 0 and new_semantic_search_topk > 0:
                create_batch_job(
                    LongRunningJob.JOB_CALCULATE_CLIP_EMBEDDINGS,
                    User.objects.get(id=instance.id),
                )

            instance.semantic_search_topk = new_semantic_search_topk
            instance.save()
            logger.info(
                "Updated semantic_search_topk for user {}".format(
                    instance.semantic_search_topk
                )
            )
        if "favorite_min_rating" in validated_data:
            new_favorite_min_rating = validated_data.pop("favorite_min_rating")
            instance.favorite_min_rating = new_favorite_min_rating
            instance.save()
            logger.info(
                "Updated favorite_min_rating for user {}".format(
                    instance.favorite_min_rating
                )
            )
        if "save_metadata_to_disk" in validated_data:
            instance.save_metadata_to_disk = validated_data.pop("save_metadata_to_disk")
            instance.save()
            logger.info(
                "Updated save_metadata_to_disk for user {}".format(
                    instance.save_metadata_to_disk
                )
            )
        if "image_scale" in validated_data:
            new_image_scale = validated_data.pop("image_scale")
            instance.image_scale = new_image_scale
            instance.save()
            logger.info("Updated image_scale for user {}".format(instance.image_scale))
        if "datetime_rules" in validated_data:
            new_datetime_rules = validated_data.pop("datetime_rules")
            instance.datetime_rules = new_datetime_rules
            instance.save()
            logger.info(
                "Updated datetime_rules for user {}".format(instance.datetime_rules)
            )
        if "default_timezone" in validated_data:
            new_default_timezone = validated_data.pop("default_timezone")
            instance.default_timezone = new_default_timezone
            instance.save()
            logger.info(
                "Updated default_timezone for user {}".format(instance.default_timezone)
            )
        cache.clear()
        return instance

    def get_photo_count(self, obj):
        return Photo.objects.filter(owner=obj).count()

    def get_public_photo_count(self, obj):
        return Photo.objects.filter(Q(owner=obj) & Q(public=True)).count()

    def get_public_photo_samples(self, obj):
        return PhotoSuperSimpleSerializer(
            Photo.objects.filter(Q(owner=obj) & Q(public=True))[:10], many=True
        ).data

    def get_avatar_url(self, obj):
        try:
            return obj.avatar.url
        except Exception:
            return None

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
            "password"
        )
        extra_kwargs = {
            "password": {"write_only": True},
        }

    def get_photo_count(self, obj):
        return Photo.objects.filter(owner=obj).count()

    def update(self, instance: User, validated_data):
        if "password" in validated_data:
            password = validated_data.pop("password")
            if password != "":
                instance.set_password(password)

        if "scan_directory" in validated_data:
            new_scan_directory = validated_data.pop("scan_directory")
            if os.path.exists(new_scan_directory):
                instance.scan_directory = new_scan_directory
                logger.info(
                    "Updated scan directory for user {}".format(instance.scan_directory)
                )
            else:
                raise ValidationError("Scan directory does not exist")
        if "username" in validated_data:
            username = validated_data.pop("username")
            if username != "":
                other_user = User.objects.filter(username=username).first()
                if other_user != None and other_user != instance:
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
        cache.clear()
        return instance
