"""The admin-editable site settings endpoint (``/api/sitesettings``)."""

from typing import Any

from constance import config as site_config
from constance import settings as constance_settings
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import AllowAny, BasePermission, IsAdminUser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.accounts.mail import email_is_configured
from api.directory_watcher.scan_schedule import (
    LAST_RUN_KEY,
    SCHEDULE_KEYS,
    parse_days,
    scan_schedule_status,
    sync_scan_schedule,
)
from api.drf.params import parse_body, parse_query
from api.drf.request_user import request_user
from api.models import LongRunningJob, User
from api.photos.retention import expired_trash_counts
from api.runtime.features import (
    FEATURES,
    Feature,
    feature_locked,
    site_setting_key,
)
from api.runtime.ml_models import (
    captioning_model_selected,
    do_all_models_exist,
    feature_model_ready,
    latest_model_download,
    start_model_download,
)
from api.search.semantic import OPENCLIP
from api.serializers.site_settings import (
    SiteSettingsRequest,
    SiteSettingsSerializer,
    TrashRetentionPreviewQuery,
    TrashRetentionPreviewSerializer,
    feature_key,
)

# The settings GET reads, in one query. The feature switches are read here,
# not through feature_enabled, so the answer to a POST shows what it saved
# even before another process's cache expires.
SETTING_KEYS = (
    "ALLOW_REGISTRATION",
    "ALLOW_UPLOAD",
    "SKIP_PATTERNS",
    "MAP_API_PROVIDER",
    "MAP_API_KEY",
    "MAP_TILE_PROVIDER",
    "CAPTIONING_MODEL",
    "OCR_MODEL",
    "FACE_RECOGNITION_MODEL",
    "NEXTCLOUD_ENABLED",
    "AUTO_CREATE_USER_DIRECTORY",
    "SCAN_MISSING_MAX_FRACTION",
    "TRASH_RETENTION_DAYS",
    *SCHEDULE_KEYS,
    LAST_RUN_KEY,
    *(site_setting_key(feature) for feature in FEATURES),
)


def _site_config(*keys: str) -> dict[str, Any]:
    """The current values of several constance settings in one query.

    ``site_config.KEY`` costs a query per key, and the login page and every
    client start read this endpoint.
    """
    stored = site_config._backend.mget(keys)
    return {
        key: stored[key]
        if stored.get(key) is not None
        else constance_settings.CONFIG[key][0]
        for key in keys
    }


def _features(config: dict[str, Any]) -> dict[str, dict[str, bool | None]]:
    """Each feature switch, for the Features card in the site settings.

    Whether the feature runs, whether the environment locked it off, and
    whether the model it runs on is on disk.
    """
    return {
        feature_key(feature): {
            "enabled": not feature_locked(feature)
            and bool(config[site_setting_key(feature)]),
            "locked": feature_locked(feature),
            "model_ready": feature_model_ready(
                feature,
                str(config["FACE_RECOGNITION_MODEL"]),
                str(config["CAPTIONING_MODEL"]),
            ),
        }
        for feature in FEATURES
    }


def _captioning_available(config: dict[str, Any]) -> bool:
    """``captioning_available()`` from the values this request read.

    Sent to everyone: the Library page shows its caption job only when
    captions can be generated (#2211).
    """
    feature: Feature = "IMAGE_CAPTIONING"
    return (
        not feature_locked(feature)
        and bool(config[site_setting_key(feature)])
        and captioning_model_selected(config["CAPTIONING_MODEL"])
    )


def _auto_scan(config: dict[str, Any]) -> dict[str, object]:
    """The automatic library scan's setting and status line (#235)."""
    return {
        "auto_scan": config["AUTO_SCAN"],
        "auto_scan_time": config["AUTO_SCAN_TIME"],
        "auto_scan_days": sorted(parse_days(str(config["AUTO_SCAN_DAYS"]))),
        "auto_scan_status": scan_schedule_status(config),
    }


def _job_status(job: LongRunningJob) -> str:
    if job.cancelled:
        return "cancelled"
    if job.failed:
        return "failed"
    return "finished" if job.finished else "running"


def _model_download() -> dict[str, object] | None:
    """The newest model download, for the status line under a switch."""
    job = latest_model_download()
    if job is None:
        return None
    return {
        "id": job.id,
        "status": _job_status(job),
        "progress_current": job.progress_current,
        "progress_target": job.progress_target,
    }


class SiteSettingsView(APIView):
    def get_permissions(self) -> list[BasePermission]:
        if self.request.method == "GET":
            self.permission_classes = (AllowAny,)
        else:
            self.permission_classes = (IsAdminUser,)

        # What APIView.get_permissions does, typed as a list of instances.
        return [permission() for permission in self.permission_classes]

    @extend_schema(responses=SiteSettingsSerializer)
    def get(self, request: Request, format: str | None = None) -> Response:
        config = _site_config(*SETTING_KEYS)
        out: dict[str, object] = {}
        out["allow_registration"] = config["ALLOW_REGISTRATION"]
        out["allow_upload"] = config["ALLOW_UPLOAD"]
        out["skip_patterns"] = config["SKIP_PATTERNS"]
        out["heavyweight_process"] = 0
        out["map_api_provider"] = config["MAP_API_PROVIDER"]
        # This GET is anonymous (the login page reads it), but the key is the
        # admin's credential for a paid geocoding provider that only the
        # backend and the admin's own settings form use. Blank rather than
        # absent so clients that require the field keep parsing.
        out["map_api_key"] = config["MAP_API_KEY"] if request.user.is_staff else ""
        out["map_tile_provider"] = config["MAP_TILE_PROVIDER"]
        out["captioning_model"] = config["CAPTIONING_MODEL"]
        out["captioning_available"] = _captioning_available(config)
        # There is no LLM any more; older mobile clients still expect the key.
        out["llm_model"] = "None"
        # One tagging model, not a setting: the web client reads it to find
        # the tags in captions_json.
        out["tagging_model"] = OPENCLIP
        out["ocr_model"] = config["OCR_MODEL"]
        out["face_recognition_model"] = config["FACE_RECOGNITION_MODEL"]
        out["nextcloud_enabled"] = config["NEXTCLOUD_ENABLED"]
        out["auto_create_user_directory"] = config["AUTO_CREATE_USER_DIRECTORY"]
        out["scan_missing_max_fraction"] = config["SCAN_MISSING_MAX_FRACTION"]
        # Not staff-only: every user's trash page says when its photos go.
        out["trash_retention_days"] = config["TRASH_RETENTION_DAYS"]
        out["email_configured"] = email_is_configured()
        if request.user.is_staff:
            # The Features card's state: admin-only, like the settings it shows.
            out["features"] = _features(config)
            out["model_download"] = _model_download()
            out.update(_auto_scan(config))
        return Response(out)

    @extend_schema(request=SiteSettingsRequest, responses=SiteSettingsSerializer)
    def post(self, request: Request, format: str | None = None) -> Response:
        data = parse_body(request, SiteSettingsRequest)
        # Each request field is the lower-case name of its constance key.
        for key, value in data.items():
            setattr(site_config, key.upper(), value)
        if any(key.upper() in SCHEDULE_KEYS for key in data):
            sync_scan_schedule()
        admin = User.objects.get(id=request_user(request).id)
        if not do_all_models_exist():
            # Not a new job per save: the settings form saves on every
            # toggle and blur, often while the first download is still
            # running, and parallel downloads write the same partial file.
            start_model_download(admin)

        return self.get(request, format=format)


class TrashRetentionPreviewView(APIView):
    """What a trash retention of N days would delete at the next cleanup (#2203).

    The Site settings card asks before it turns the retention on or shortens
    it, with this count. It counts every user's trash, which is what the
    retention deletes, so only an admin may ask.
    """

    permission_classes = (IsAdminUser,)

    @extend_schema(
        parameters=[TrashRetentionPreviewQuery],
        responses=TrashRetentionPreviewSerializer,
    )
    def get(self, request: Request, format: str | None = None) -> Response:
        days = parse_query(request, TrashRetentionPreviewQuery)["days"]
        photo_count, user_count = expired_trash_counts(days)
        return Response(
            {"days": days, "photo_count": photo_count, "user_count": user_count}
        )
