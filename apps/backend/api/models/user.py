import os
from typing import Any

import pytz
from django.conf import settings
from django.contrib.auth.models import AbstractUser
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django_cryptography.fields import encrypt

from api.metadata.datetime_rules import DEFAULT_RULES_JSON
from api.models.photo_license import LICENSE_MAX_LENGTH, PhotoLicense
from api.stacks.burst_rules import get_default_burst_detection_rules


def get_default_config_datetime_rules() -> str:  # This is a callable
    return DEFAULT_RULES_JSON


def get_default_config_burst_detection_rules() -> list[dict[str, Any]]:
    # This is a callable
    return get_default_burst_detection_rules()


def get_default_llm_settings() -> dict[str, bool]:
    """Caption context: what a generated caption may know about the photo.

    The field keeps its historical name; the switches used to feed a separate
    LLM and now steer the captioning model's prompt directly. Names and
    places are on by default: a caption that says who and where is the point.
    Keys that older versions stored (add_keywords, custom_prompt and the like)
    may still be in a user's row; nothing reads them.
    """
    return {
        "enabled": True,
        "add_person": True,
        "add_location": True,
    }


def get_default_public_sharing_settings() -> dict[str, bool]:
    """Default settings for what metadata to share in public albums.

    All options default to False (opt-in) for privacy-first approach.
    Users can change their defaults, and per-album overrides take precedence.
    """
    return {
        "share_location": False,  # GPS coordinates and location names
        "share_camera_info": False,  # Camera make/model, lens, settings
        "share_timestamps": False,  # Date/time when photo was taken
        "share_captions": False,  # AI-generated or user captions
        "share_faces": False,  # Detected faces (always recommend False)
    }


def public_sharing_settings(owner: object) -> dict[str, bool]:
    """What ``owner``'s public pages share: the system defaults (all off)
    under the owner's own defaults.

    ``public_sharing_defaults`` is a JSON column: a switch counts as on only
    when it holds ``true``, so a stored ``"no"`` or a missing key is off.
    """
    settings = get_default_public_sharing_settings()
    saved = getattr(owner, "public_sharing_defaults", None)
    if isinstance(saved, dict):
        for key in settings:
            settings[key] = saved.get(key) is True
    return settings


class User(AbstractUser):
    scan_directory = models.CharField(
        max_length=512, db_index=True, blank=True, default=""
    )
    # Where web uploads are written. Empty means the "uploads" folder inside
    # scan_directory; use upload_root() rather than reading this directly.
    upload_directory = models.CharField(max_length=512, blank=True, default="")
    # Folders inside the library that the user left out (#791): scans skip
    # them, and their photos count as outside the library. Absolute paths
    # spelled from their library folder; api.photos.library_folders checks them.
    excluded_folders = models.JSONField(default=list, blank=True)
    confidence = models.FloatField(default=0.1, db_index=True)
    confidence_person = models.FloatField(default=0.9)
    image_scale = models.FloatField(default=1)
    semantic_search_topk = models.IntegerField(default=0)
    avatar = models.ImageField(upload_to="avatars", null=True, blank=True)
    transcode_videos = models.BooleanField(default=False)
    nextcloud_server_address = models.CharField(max_length=200, default="", blank=True)
    nextcloud_username = models.CharField(max_length=64, default="", blank=True)
    nextcloud_app_password = encrypt(
        models.CharField(max_length=64, default="", blank=True)
    )
    nextcloud_scan_directory = models.CharField(
        max_length=512, db_index=True, default="", blank=True
    )

    favorite_min_rating = models.IntegerField(
        default=settings.DEFAULT_FAVORITE_MIN_RATING, db_index=True
    )

    class RatingMode(models.TextChoices):
        # A favorite toggle: favoriting sets the rating to favorite_min_rating,
        # removing a favorite sets it to 0 (#2202, option A).
        FAVORITE = "favorite"
        # 1-5 stars set through /photosedit/rating/; the web never calls
        # /photosedit/favorite/ in this mode.
        STARS = "stars"

    rating_mode = models.CharField(
        max_length=16, choices=RatingMode.choices, default=RatingMode.FAVORITE
    )

    class SaveMetadata(models.TextChoices):
        OFF = "OFF"
        MEDIA_FILE = "MEDIA_FILE"
        SIDECAR_FILE = "SIDECAR_FILE"

    save_metadata_to_disk = models.TextField(
        choices=SaveMetadata.choices, default=SaveMetadata.OFF
    )
    save_face_tags_to_disk = models.BooleanField(default=False)
    llm_settings = models.JSONField(default=get_default_llm_settings)
    datetime_rules = models.JSONField(default=get_default_config_datetime_rules)
    burst_detection_rules = models.JSONField(
        default=get_default_config_burst_detection_rules
    )
    default_timezone = models.TextField(
        choices=[(x, x) for x in pytz.all_timezones],
        default="UTC",
    )
    public_sharing = models.BooleanField(default=False)
    public_sharing_defaults = models.JSONField(
        default=get_default_public_sharing_settings
    )
    # Whether the users this user shares photos or albums with see the names
    # of the people the user named on those photos (#2722). Off by default:
    # recipients then see no people at all. Public links follow
    # ``public_sharing_defaults["share_faces"]`` instead.
    share_people_names = models.BooleanField(default=False)
    # The rights this user gives their photos (#425): Settings > Metadata
    # "Rights for your photos". A photo whose file states none gets them when
    # it is first scanned, and "Apply" sets them on photos already there
    # (``api.metadata.edits.apply_rights_default``). "{year}" in the
    # copyright becomes the year the photo was taken.
    default_license = models.CharField(
        max_length=LICENSE_MAX_LENGTH,
        choices=PhotoLicense.choices,
        blank=True,
        default="",
    )
    default_creator = models.CharField(max_length=200, blank=True, default="")
    default_copyright = models.TextField(blank=True, default="")

    min_cluster_size = models.IntegerField(default=0)
    confidence_unknown_face = models.FloatField(default=0.5)
    min_samples = models.IntegerField(default=1)
    cluster_selection_epsilon = models.FloatField(default=0.95)
    # Detected faces lower than this share of the big thumbnail's shorter side
    # are not saved (#2749): strangers far in the background. 0 keeps all.
    min_face_size = models.FloatField(
        default=0, validators=[MinValueValidator(0), MaxValueValidator(0.5)]
    )

    class TextAlignment(models.TextChoices):
        LEFT = "left"
        RIGHT = "right"

    text_alignment = models.TextField(
        choices=TextAlignment.choices, default=TextAlignment.RIGHT
    )

    class HeaderSize(models.TextChoices):
        LARGE = "large"
        NORMAL = "normal"
        SMALL = "small"

    header_size = models.TextField(choices=HeaderSize.choices, default=HeaderSize.LARGE)

    # How the scroll scrubber beside a photo list looks: a thumb with a date
    # bubble, or a map of how many photos each month holds.
    class ScrubberStyle(models.TextChoices):
        THUMB = "thumb"
        DENSITY = "density"

    scrubber_style = models.TextField(
        choices=ScrubberStyle.choices, default=ScrubberStyle.THUMB
    )

    # Which end of the date-grouped photo lists comes first (#2712): the
    # newest day or the oldest, by date taken. See api.albums.photo_order.
    class PhotoOrder(models.TextChoices):
        NEWEST = "newest"
        OLDEST = "oldest"

    photo_order = models.TextField(
        choices=PhotoOrder.choices, default=PhotoOrder.NEWEST
    )
    # No longer read: every scan imports RAW files and groups a RAW with its
    # JPEG as file variants. The user API still returns both, read-only, so
    # released clients keep parsing the user object (#2219); the columns are
    # dropped in a later release.
    skip_raw_files = models.BooleanField(default=False)
    stack_raw_jpeg = models.BooleanField(default=True)
    slideshow_interval = models.IntegerField(default=5)
    # What the main timeline shows when its URL names no filter: any of
    # "media" ("all"/"photos"/"videos"), "hide_screenshots", "hide_documents"
    # and "favorites". Empty shows everything. See api.albums.timeline_filter.
    default_timeline_filter = models.JSONField(default=dict, blank=True)
    # The "What's new" card (#2305): the release whose card this user last
    # closed or opened ("" before the first one), and whether the card shows
    # after an update at all. The account menu opens it either way.
    last_seen_release = models.CharField(max_length=32, blank=True, default="")
    show_whats_new = models.BooleanField(default=True)

    # Duplicate detection settings
    class DuplicateSensitivity(models.TextChoices):
        STRICT = "strict"
        NORMAL = "normal"
        LOOSE = "loose"

    duplicate_sensitivity = models.TextField(
        choices=DuplicateSensitivity.choices, default=DuplicateSensitivity.NORMAL
    )
    duplicate_clear_existing = models.BooleanField(default=False)

    # Delta-sync ordering key for the sharing surface (mobile v2, doc 04):
    # a profile change (name/avatar) must reach clients that mirror this user
    # as a "shared_user" row.
    last_modified = models.DateTimeField(auto_now=True, db_index=True)

    def upload_root(self) -> str:
        """Folder that web uploads go to, one subfolder per uploading device."""
        if self.upload_directory:
            return self.upload_directory
        return os.path.join(self.scan_directory, "uploads")


def get_deleted_user() -> User:
    deleted_user: User = User.objects.get_or_create(username="deleted")[0]
    if deleted_user.is_active is not False:
        deleted_user.is_active = False
        deleted_user.save()
    return deleted_user
