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


def comparable_path(path):
    """Spell ``path`` the way the filesystem tells directories apart.

    ``realpath`` folds a symlink onto its target, so a link into another
    user's library is seen for what it is. ``normcase`` folds case and
    separators on Windows, where ``C:\\Data\\alice`` and ``c:/data/alice``
    are the same directory; it is a no-op on POSIX. Neither needs the path to
    exist: ``realpath`` resolves as much of it as it can.
    """
    return os.path.normcase(os.path.realpath(path))


def directories_overlap(one, other):
    """True when two directories are the same or one contains the other."""
    one, other = comparable_path(one), comparable_path(other)
    return is_valid_path(one, other) or is_valid_path(other, one)


def reject_overlap_with_another_user(abs_scan_directory, user):
    """Refuse a library root that another user already scans.

    A photo has exactly one owner, so two users pointed at overlapping trees
    give an outcome that depends on which scan runs first: the second either
    skips the files the first already owns, or takes them over. Equal, parent
    and child paths all have that problem, so all three are rejected (#2034).

    Leaving the directory as it is never conflicts, even when it already
    overlaps -- an install that predates this check has to stay editable,
    rather than having every other field on that user locked behind a
    directory the admin may not want to move.
    """
    # Compare normalised forms: a directory stored before this check, or by an
    # older version, may carry a trailing separator or a non-canonical
    # spelling, and a raw string compare would read that as a change and lock
    # the user out of its own directory.
    if user is not None and user.scan_directory:
        if comparable_path(abs_scan_directory) == comparable_path(user.scan_directory):
            return

    others = User.objects.exclude(scan_directory="")
    if user is not None and user.pk is not None:
        others = others.exclude(pk=user.pk)

    for other in others.only("pk", "username", "scan_directory").iterator():
        if directories_overlap(abs_scan_directory, other.scan_directory):
            raise ValidationError(
                f"Scan directory overlaps the library of user "
                f"'{other.username}' ({other.scan_directory}). Every photo has "
                f"exactly one owner, so two users cannot scan the same files."
            )


def normalize_scan_directory(scan_directory, user=None):
    """Return ``scan_directory`` as a usable absolute library root.

    Returns ``None`` when nothing was supplied, so callers can leave the
    stored value untouched. Raises ``ValidationError`` when the path escapes
    ``settings.DATA_ROOT``, does not exist on disk, or overlaps another
    user's library.

    ``user`` is the account the directory is being set on, so that its own
    current directory is not read as a conflict with itself. Leave it out when
    creating a user, where there is no account yet and every other user's
    directory is somebody else's.
    """
    if not scan_directory:
        return None

    abs_scan_directory = os.path.abspath(scan_directory)

    if not is_valid_path(abs_scan_directory, settings.DATA_ROOT):
        raise ValidationError("Scan directory must be inside the data root.")

    if not os.path.exists(abs_scan_directory):
        raise ValidationError("Scan directory does not exist")

    reject_overlap_with_another_user(abs_scan_directory, user)

    return abs_scan_directory


def auto_create_user_directory(user, claim_existing=False):
    """Give ``user`` its own folder under ``DATA_ROOT``, when that is enabled.

    Off unless the ``AUTO_CREATE_USER_DIRECTORY`` site setting is on. A
    directory supplied on create is never overwritten -- an admin who typed a
    path meant it (#2038).

    The folder is ``DATA_ROOT/<username>``. Everything that can refuse it is
    checked before anything is created, so a refusal leaves nothing behind:

    - the username has to name a direct child of ``DATA_ROOT`` (``.`` and
      ``..`` do not);
    - it must not overlap another user's scan directory (#2034). On the
      default layout, where the admin scans ``DATA_ROOT`` itself, every
      candidate overlaps, so the feature needs the admin on a subfolder;
    - a folder that already exists is only taken over when
      ``claim_existing`` is set. That is for an admin creating the account,
      who can see what is in it. A self-registered or SSO user must not be
      able to claim a folder just by picking its name as a username -- an
      account called ``family`` would otherwise get ``DATA_ROOT/family``.

    Nothing here can fail user creation. A library mount is often read-only,
    and an account with no scan directory is still a usable account: the user
    sees an empty library and an admin can assign one later. So every refusal
    is logged and returned from, not raised.
    """
    from constance import config as site_config

    if not site_config.AUTO_CREATE_USER_DIRECTORY or user.scan_directory:
        return

    def refuse(reason):
        logger.warning(
            f"Not creating a data folder for user {user.username}: {reason}. "
            f"The account was created without a scan directory; assign one "
            f"in the Admin Area."
        )

    data_root = os.path.abspath(settings.DATA_ROOT)
    candidate = os.path.abspath(os.path.join(data_root, user.username))
    if os.path.dirname(candidate) != data_root:
        refuse(f"the username does not name a folder directly inside {data_root}")
        return

    try:
        reject_overlap_with_another_user(candidate, user)
    except ValidationError as error:
        refuse(f"{candidate} is not available. {' '.join(error.detail)}")
        return

    if os.path.lexists(candidate):
        if not claim_existing:
            refuse(
                f"{candidate} already exists and may hold someone else's photos, "
                f"so it is not handed to a self-registered or single sign-on "
                f"account"
            )
            return
        if not os.path.isdir(candidate):
            refuse(f"{candidate} exists but is not a directory")
            return
    else:
        try:
            # No exist_ok: if the folder appeared since the check above, it is
            # not ours to claim.
            os.makedirs(candidate)
        except FileExistsError:
            if not claim_existing:
                refuse(f"{candidate} was created by something else meanwhile")
                return
        except OSError as error:
            refuse(f"could not create {candidate}: {error}")
            return

    user.scan_directory = candidate
    user.save(update_fields=["scan_directory"])
    logger.info(f"Assigned data folder {candidate} to user {user.username}")


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
            else:
                # Creation must apply the same guard rails as an update,
                # otherwise a user can be created pointing outside DATA_ROOT
                # or at a directory that does not exist. See issue #492.
                abs_scan_directory = normalize_scan_directory(
                    validated_data["scan_directory"]
                )
                if abs_scan_directory is None:
                    validated_data.pop("scan_directory")
                else:
                    validated_data["scan_directory"] = abs_scan_directory
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
        # Only an admin gets here (anonymous sign-up uses SignupUserSerializer),
        # so an existing folder of that name is theirs to hand out.
        auto_create_user_directory(user, claim_existing=True)
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
        auto_create_user_directory(user)
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
        abs_new_scan_directory = normalize_scan_directory(
            new_scan_directory, user=instance
        )
        if abs_new_scan_directory is None:
            return

        instance.scan_directory = abs_new_scan_directory
        logger.info(f"Updated scan directory for user {instance.scan_directory}")

    def apply_username(self, instance: User, username):
        if username != "":
            other_user = User.objects.filter(username=username).first()
            if other_user is not None and other_user != instance:
                raise ValidationError("User name is already taken")

        instance.username = username
