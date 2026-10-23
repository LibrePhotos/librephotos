"""The body and the answer of /api/sitesettings."""

import re
from collections.abc import Mapping

from rest_framework import serializers

from api.directory_watcher.scan_schedule import (
    FREQUENCIES,
    is_valid_time,
    stored_days,
)
from api.drf.params import (
    JsonBooleanField,
    JsonFractionField,
    JsonIntegerField,
    JsonStringField,
)
from api.geocode.config import MAP_API_PROVIDERS
from api.runtime.features import (
    FEATURES,
    Feature,
    env_flag_name,
    feature_locked,
    site_setting_key,
)
from api.updates.check import update_check_locked


def feature_field(feature: Feature) -> str:
    """The request field of a feature's site switch: its constance key, lower case."""
    return site_setting_key(feature).lower()


def feature_key(feature: Feature) -> str:
    """The feature's key in the answer's ``features`` object."""
    return feature.lower()


# One language tag ("de", "pt-BR", "zh-Hans"), or a list of them in order of
# preference ("de,en"), as GEOCODE_LANGUAGE holds it (#2745).
_LANGUAGE_TAG = r"[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*"
GEOCODE_LANGUAGE_RE = re.compile(rf"{_LANGUAGE_TAG}(?:,{_LANGUAGE_TAG})*")


def normalize_geocode_language(value: str) -> str:
    """*value* without the spaces around it and its commas; "" stays ""."""
    return ",".join(part.strip() for part in value.split(",")) if value.strip() else ""


# A hundred years: far past any real retention, well inside what a timedelta
# can subtract from today.
MAX_TRASH_RETENTION_DAYS = 36500

# Long enough for "Sign in with <a long provider name>", short enough for the
# login page button.
MAX_OIDC_BUTTON_LABEL = 64


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
    geocode_language = JsonStringField(
        required=False,
        help_text="The language online map providers name places in: a code such as"
        " de or pt-BR, or a list such as de,en (Nominatim); empty for the provider's"
        " default.",
    )
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
    # The automatic library scan (#235).
    auto_scan = serializers.ChoiceField(
        choices=FREQUENCIES,
        required=False,
        help_text="Scan every library automatically: off, hourly, daily, or"
        " custom (the days in auto_scan_days).",
    )
    auto_scan_time = JsonStringField(
        required=False,
        help_text="When a daily or custom scan starts, HH:MM in the server's time zone.",
    )
    auto_scan_days = serializers.ListField(
        child=JsonIntegerField(min_value=0, max_value=6),
        allow_empty=False,
        required=False,
        help_text="The weekdays a custom scan runs, 0 (Monday) to 6 (Sunday).",
    )
    # The feature switches (api/runtime/features.py). A switch the server
    # environment turned off is locked: writing it is a 400 naming the field.
    video_enabled = JsonBooleanField(required=False)
    face_detection_enabled = JsonBooleanField(required=False)
    face_cluster_enabled = JsonBooleanField(required=False)
    image_captioning_enabled = JsonBooleanField(required=False)
    reverse_geocoding_enabled = JsonBooleanField(required=False)
    scene_classification_enabled = JsonBooleanField(required=False)
    video_previews_enabled = JsonBooleanField(required=False)
    face_detection_in_videos_enabled = JsonBooleanField(required=False)
    # Single sign-on (#2725). The providers themselves live in the Django admin.
    oidc_enabled = JsonBooleanField(
        required=False,
        help_text="Show the single sign-on button; off also stops SSO logins.",
    )
    oidc_button_label = JsonStringField(
        required=False,
        help_text="The text on the login page's single sign-on button, trimmed,"
        f" at most {MAX_OIDC_BUTTON_LABEL} characters.",
    )
    oidc_allow_signup = JsonBooleanField(
        required=False,
        help_text="Let a first SSO login with an unknown email create an account;"
        " needs email to be set up as well.",
    )
    # The daily update check (#2311). Locked off by UPDATE_CHECK=false.
    update_check = JsonBooleanField(
        required=False,
        help_text="Ask github.com once a day for the newest release and tell admins"
        " about a newer one; turning it on checks at once.",
    )

    # The What's new card after an update (#2305).
    whats_new_enabled = JsonBooleanField(
        required=False,
        help_text="Show each user a What's new card once after an update.",
    )

    def validate_update_check(self, value: bool) -> bool:
        if value and update_check_locked():
            raise serializers.ValidationError(
                "UPDATE_CHECK is turned off in the server environment. Change it"
                " there and restart the server.",
                code="update_check_locked",
            )
        return value

    def validate_oidc_button_label(self, value: str) -> str:
        label = value.strip()
        if len(label) > MAX_OIDC_BUTTON_LABEL:
            raise serializers.ValidationError(
                f"Use at most {MAX_OIDC_BUTTON_LABEL} characters.",
                code="max_length",
            )
        return label

    def validate_map_api_provider(self, value: str) -> str:
        # reverse_geocode cannot ask a provider it does not know: every photo
        # would be left without a place, and only a warning in the log says why.
        if value not in MAP_API_PROVIDERS:
            raise serializers.ValidationError(
                f"Choose one of: {', '.join(sorted(MAP_API_PROVIDERS))}.",
                code="unknown_map_api_provider",
            )
        return value

    def validate_geocode_language(self, value: str) -> str:
        language = normalize_geocode_language(value)
        if language and not GEOCODE_LANGUAGE_RE.fullmatch(language):
            raise serializers.ValidationError(
                "Use a language code like de or pt-BR, or a list like de,en;"
                " leave it empty for the provider's default.",
                code="invalid_geocode_language",
            )
        return language

    def validate_auto_scan_time(self, value: str) -> str:
        if not is_valid_time(value):
            raise serializers.ValidationError("Give the time as HH:MM, 00:00 to 23:59.")
        return value

    def validate_auto_scan_days(self, value: list[int]) -> str:
        """The days as ``AUTO_SCAN_DAYS`` stores them, which the view saves."""
        return stored_days(value)

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
    """The feature switches, by feature."""

    video = SiteFeatureStateSerializer()
    face_detection = SiteFeatureStateSerializer()
    face_cluster = SiteFeatureStateSerializer()
    image_captioning = SiteFeatureStateSerializer()
    reverse_geocoding = SiteFeatureStateSerializer()
    scene_classification = SiteFeatureStateSerializer()
    video_previews = SiteFeatureStateSerializer()
    face_detection_in_videos = SiteFeatureStateSerializer()


class SiteModelDownloadSerializer(serializers.Serializer[None]):
    """The newest Download Models job."""

    id = serializers.IntegerField()
    # A string, not an enum: a state a later server adds must not break the
    # clients that parse this anonymous answer.
    status = serializers.CharField(help_text="running, finished, failed or cancelled")
    progress_current = serializers.IntegerField()
    progress_target = serializers.IntegerField()


class SiteAutoScanStatusSerializer(serializers.Serializer[None]):
    """The automatic scan's last run and next run, by username."""

    last_run_at = serializers.DateTimeField(
        allow_null=True, help_text="When it last ran; null before the first run."
    )
    scanned = serializers.ListField(
        child=serializers.CharField(),
        help_text="Users whose scans of that run finished.",
    )
    running = serializers.ListField(
        child=serializers.CharField(),
        help_text="Users whose scans of that run are queued or running.",
    )
    skipped = serializers.ListField(
        child=serializers.CharField(),
        help_text="Users skipped because a scan of theirs was still running.",
    )
    failed = serializers.ListField(
        child=serializers.CharField(),
        help_text="Users whose library could not be scanned, or whose scan failed.",
    )
    next_run_at = serializers.DateTimeField(
        allow_null=True, help_text="The next run; null while it is off."
    )
    time_zone = serializers.CharField(
        help_text="The server's time zone, which auto_scan_time is in."
    )


class SiteSsoProviderSerializer(serializers.Serializer[None]):
    """One OpenID Connect provider configured in the Django admin."""

    name = serializers.CharField()
    on_this_site = serializers.BooleanField(
        help_text="Attached to this site; the login page offers only those."
    )


class SiteSettingsSerializer(serializers.Serializer[None]):
    """What GET (and a successful POST) answers.

    ``features``, ``model_download``, the ``auto_scan`` fields, ``update_check``,
    ``sso_providers`` and ``public_url_configured`` are sent to staff only; the
    GET is anonymous (the login page reads it).
    """

    allow_registration = serializers.BooleanField()
    allow_upload = serializers.BooleanField()
    skip_patterns = serializers.CharField()
    heavyweight_process = serializers.IntegerField()
    map_api_provider = serializers.CharField()
    map_api_key = serializers.CharField(help_text="Blank unless the caller is staff.")
    map_tile_provider = serializers.CharField()
    geocode_language = serializers.CharField(
        help_text="The language online map providers name places in; empty for the"
        " provider's default."
    )
    captioning_model = serializers.CharField()
    captioning_available = serializers.BooleanField(
        help_text="Captions can be generated: the image captioning switch is on"
        " and a captioning model is picked. Sent to everyone."
    )
    things_available = serializers.BooleanField(
        help_text="Things can be found: the Things switch is on and the"
        " environment does not lock it off. Sent to everyone."
    )
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
    remember_me_days = serializers.IntegerField(
        help_text="Days a sign-in with Remember me lasts (REMEMBER_ME_DAYS); 0 means"
        " the login page does not offer it. Sent to everyone: the login page reads it."
    )
    oidc_enabled = serializers.BooleanField()
    oidc_button_label = serializers.CharField()
    oidc_allow_signup = serializers.BooleanField()
    sso_providers = SiteSsoProviderSerializer(
        many=True,
        required=False,
        help_text="The OpenID Connect providers, by name. Staff only.",
    )
    public_url_configured = serializers.BooleanField(
        required=False,
        help_text="Whether the public URL single sign-on needs is known"
        " (FRONTEND_BASE_URL). Staff only.",
    )
    features = SiteFeaturesSerializer(required=False)
    auto_scan = serializers.CharField(
        required=False, help_text="off, hourly, daily or custom. Staff only."
    )
    auto_scan_time = serializers.CharField(
        required=False, help_text="HH:MM in the server's time zone. Staff only."
    )
    auto_scan_days = serializers.ListField(
        child=serializers.IntegerField(),
        required=False,
        help_text="Weekdays of a custom scan, 0 (Monday) to 6. Staff only.",
    )
    auto_scan_status = SiteAutoScanStatusSerializer(required=False)
    update_check = serializers.BooleanField(
        required=False,
        help_text="The update check's site switch (GET /api/updates/ has its"
        " state). Staff only.",
    )
    model_download = SiteModelDownloadSerializer(required=False, allow_null=True)
    whats_new_enabled = serializers.BooleanField(
        help_text="Whether users see a What's new card once after an update"
        " (each user can also turn it off). Sent to everyone."
    )


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
