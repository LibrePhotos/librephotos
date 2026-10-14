"""The body and the answer of /api/sitesettings."""

from collections.abc import Mapping

from rest_framework import serializers

from api.drf.params import (
    JsonBooleanField,
    JsonFractionField,
    JsonIntegerField,
    JsonStringField,
)
from api.runtime.features import (
    FEATURES,
    Feature,
    env_flag_name,
    feature_locked,
    site_setting_key,
)


def feature_field(feature: Feature) -> str:
    """The request field of a feature's site switch: its constance key, lower case."""
    return site_setting_key(feature).lower()


def feature_key(feature: Feature) -> str:
    """The feature's key in the answer's ``features`` object."""
    return feature.lower()


# A hundred years: far past any real retention, well inside what a timedelta
# can subtract from today.
MAX_TRASH_RETENTION_DAYS = 36500


class SiteSettingsRequest(serializers.Serializer[None]):
    """The settings to change: every field optional, at least one present.

    Keys the endpoint does not store (``heavyweight_process``, ``llm_model``,
    ...) are ignored, so a client may post back what GET returned.
    """

    allow_registration = JsonBooleanField(required=False)
    allow_upload = JsonBooleanField(required=False)
    skip_patterns = JsonStringField(required=False)
    map_api_provider = JsonStringField(required=False)
    map_api_key = JsonStringField(required=False)
    map_tile_provider = JsonStringField(required=False)
    captioning_model = JsonStringField(required=False)
    ocr_model = JsonStringField(required=False)
    face_recognition_model = JsonStringField(required=False)
    nextcloud_enabled = JsonBooleanField(required=False)
    auto_create_user_directory = JsonBooleanField(required=False)
    scan_missing_max_fraction = JsonFractionField(
        required=False,
        help_text="Largest share of a user's photos a scan may flag missing at once"
        " (0 to 1); 1 turns the check off.",
    )
    trash_retention_days = JsonIntegerField(
        required=False,
        min_value=0,
        max_value=MAX_TRASH_RETENTION_DAYS,
        help_text="Days a photo stays in the trash before it and its files are"
        " deleted for good; 0 keeps it until its owner empties the trash.",
    )
    # The feature switches (api/runtime/features.py). A switch the server
    # environment turned off is locked: writing it is a 400 naming the field.
    video_enabled = JsonBooleanField(required=False)
    face_detection_enabled = JsonBooleanField(required=False)
    face_cluster_enabled = JsonBooleanField(required=False)
    image_captioning_enabled = JsonBooleanField(required=False)
    reverse_geocoding_enabled = JsonBooleanField(required=False)
    scene_classification_enabled = JsonBooleanField(required=False)

    def validate(self, attrs: Mapping[str, object]) -> Mapping[str, object]:
        if not attrs:
            raise serializers.ValidationError(
                f"Give at least one of: {', '.join(self.fields)}."
            )
        locked = {
            feature_field(feature): (
                f"{env_flag_name(feature)} is turned off in the server environment."
                " Change it there and restart the server."
            )
            for feature in FEATURES
            if feature_field(feature) in attrs and feature_locked(feature)
        }
        if locked:
            raise serializers.ValidationError(locked, code="feature_locked")
        return attrs


class SiteFeatureStateSerializer(serializers.Serializer[None]):
    """One optional feature as the Features card shows it."""

    enabled = serializers.BooleanField(
        help_text="Whether the feature runs: the environment allows it and the site switch is on."
    )
    locked = serializers.BooleanField(
        help_text="The FEATURE_* environment variable turned it off; the site switch cannot."
    )
    model_ready = serializers.BooleanField(
        allow_null=True,
        help_text="Whether its model is on disk; null for a feature that needs none.",
    )


class SiteFeaturesSerializer(serializers.Serializer[None]):
    """The six feature switches, by feature."""

    video = SiteFeatureStateSerializer()
    face_detection = SiteFeatureStateSerializer()
    face_cluster = SiteFeatureStateSerializer()
    image_captioning = SiteFeatureStateSerializer()
    reverse_geocoding = SiteFeatureStateSerializer()
    scene_classification = SiteFeatureStateSerializer()


class SiteModelDownloadSerializer(serializers.Serializer[None]):
    """The newest Download Models job."""

    id = serializers.IntegerField()
    # A string, not an enum: a state a later server adds must not break the
    # clients that parse this anonymous answer.
    status = serializers.CharField(help_text="running, finished, failed or cancelled")
    progress_current = serializers.IntegerField()
    progress_target = serializers.IntegerField()


class SiteSettingsSerializer(serializers.Serializer[None]):
    """What GET (and a successful POST) answers.

    ``features`` and ``model_download`` are sent to staff only; the GET is
    anonymous (the login page reads it).
    """

    allow_registration = serializers.BooleanField()
    allow_upload = serializers.BooleanField()
    skip_patterns = serializers.CharField()
    heavyweight_process = serializers.IntegerField()
    map_api_provider = serializers.CharField()
    map_api_key = serializers.CharField(help_text="Blank unless the caller is staff.")
    map_tile_provider = serializers.CharField()
    captioning_model = serializers.CharField()
    llm_model = serializers.CharField()
    tagging_model = serializers.CharField()
    ocr_model = serializers.CharField()
    face_recognition_model = serializers.CharField()
    nextcloud_enabled = serializers.BooleanField()
    auto_create_user_directory = serializers.BooleanField()
    scan_missing_max_fraction = serializers.FloatField()
    trash_retention_days = serializers.IntegerField(
        help_text="Days a photo stays in the trash before the daily cleanup deletes"
        " it and its files; 0 means never. Sent to everyone: the trash page says"
        " when a photo goes."
    )
    email_configured = serializers.BooleanField()
    features = SiteFeaturesSerializer(required=False)
    model_download = SiteModelDownloadSerializer(required=False, allow_null=True)


class TrashRetentionPreviewQuery(serializers.Serializer[None]):
    """The retention to count for: the days the admin is about to save."""

    days = serializers.IntegerField(
        min_value=1,
        max_value=MAX_TRASH_RETENTION_DAYS,
        help_text="Days a photo may stay in the trash.",
    )


class TrashRetentionPreviewSerializer(serializers.Serializer[None]):
    """What the next daily cleanup would delete with that retention."""

    days = serializers.IntegerField()
    photo_count = serializers.IntegerField(
        help_text="Photos in any user's trash for longer than ``days`` days."
    )
    user_count = serializers.IntegerField(help_text="Users those photos belong to.")
