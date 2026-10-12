"""The admin-editable site settings endpoint (``/api/sitesettings``)."""

from typing import Any

from constance import config as site_config
from constance import settings as constance_settings
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import AllowAny, BasePermission, IsAdminUser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.mail import email_is_configured
from api.ml_models import do_all_models_exist, start_model_download
from api.models import User
from api.request_user import request_user
from api.semantic_search import OPENCLIP
from api.serializers.site_settings import SiteSettingsRequest
from api.views.params import parse_body


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


class SiteSettingsView(APIView):
    def get_permissions(self) -> list[BasePermission]:
        if self.request.method == "GET":
            self.permission_classes = (AllowAny,)
        else:
            self.permission_classes = (IsAdminUser,)

        # What APIView.get_permissions does, typed as a list of instances.
        return [permission() for permission in self.permission_classes]

    def get(self, request: Request, format: str | None = None) -> Response:
        config = _site_config(
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
        )
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
        # There is no LLM any more; older mobile clients still expect the key.
        out["llm_model"] = "None"
        # One tagging model, not a setting: the web client reads it to find
        # the tags in captions_json.
        out["tagging_model"] = OPENCLIP
        out["ocr_model"] = config["OCR_MODEL"]
        out["face_recognition_model"] = config["FACE_RECOGNITION_MODEL"]
        out["nextcloud_enabled"] = config["NEXTCLOUD_ENABLED"]
        out["auto_create_user_directory"] = config["AUTO_CREATE_USER_DIRECTORY"]
        out["email_configured"] = email_is_configured()
        return Response(out)

    @extend_schema(request=SiteSettingsRequest)
    def post(self, request: Request, format: str | None = None) -> Response:
        data = parse_body(request, SiteSettingsRequest)
        # Each request field is the lower-case name of its constance key.
        for key, value in data.items():
            setattr(site_config, key.upper(), value)
        admin = User.objects.get(id=request_user(request).id)
        if not do_all_models_exist():
            # Not a new job per save: the settings form saves on every
            # toggle and blur, often while the first download is still
            # running, and parallel downloads write the same partial file.
            start_model_download(admin)

        return self.get(request, format=format)
