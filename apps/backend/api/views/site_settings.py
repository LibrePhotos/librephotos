"""The admin-editable site settings endpoint (``/api/sitesettings``)."""

import jsonschema
from constance import config as site_config
from django_q.tasks import AsyncTask
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from api.mail import email_is_configured
from api.ml_models import do_all_models_exist, download_models
from api.models import User
from api.schemas.site_settings import site_settings_schema


class SiteSettingsView(APIView):
    def get_permissions(self):
        if self.request.method == "GET":
            self.permission_classes = (AllowAny,)
        else:
            self.permission_classes = (IsAdminUser,)

        return super(SiteSettingsView, self).get_permissions()

    def get(self, request, format=None):
        out = {}
        out["allow_registration"] = site_config.ALLOW_REGISTRATION
        out["allow_upload"] = site_config.ALLOW_UPLOAD
        out["skip_patterns"] = site_config.SKIP_PATTERNS
        out["heavyweight_process"] = 0
        out["map_api_provider"] = site_config.MAP_API_PROVIDER
        out["map_api_key"] = site_config.MAP_API_KEY
        out["map_tile_provider"] = site_config.MAP_TILE_PROVIDER
        out["captioning_model"] = site_config.CAPTIONING_MODEL
        # There is no LLM any more; older mobile clients still expect the key.
        out["llm_model"] = "None"
        out["tagging_model"] = site_config.TAGGING_MODEL
        out["ocr_model"] = site_config.OCR_MODEL
        out["face_recognition_model"] = site_config.FACE_RECOGNITION_MODEL
        out["nextcloud_enabled"] = site_config.NEXTCLOUD_ENABLED
        out["auto_create_user_directory"] = site_config.AUTO_CREATE_USER_DIRECTORY
        out["email_configured"] = email_is_configured()
        return Response(out)

    def post(self, request, format=None):
        jsonschema.validate(request.data, site_settings_schema)
        if "allow_registration" in request.data.keys():
            site_config.ALLOW_REGISTRATION = request.data["allow_registration"]
        if "allow_upload" in request.data.keys():
            site_config.ALLOW_UPLOAD = request.data["allow_upload"]
        if "skip_patterns" in request.data.keys():
            site_config.SKIP_PATTERNS = request.data["skip_patterns"]
        if "map_api_provider" in request.data.keys():
            site_config.MAP_API_PROVIDER = request.data["map_api_provider"]
        if "map_api_key" in request.data.keys():
            site_config.MAP_API_KEY = request.data["map_api_key"]
        if "map_tile_provider" in request.data.keys():
            site_config.MAP_TILE_PROVIDER = request.data["map_tile_provider"]
        if "captioning_model" in request.data.keys():
            site_config.CAPTIONING_MODEL = request.data["captioning_model"]
        if "tagging_model" in request.data.keys():
            site_config.TAGGING_MODEL = request.data["tagging_model"]
        if "ocr_model" in request.data.keys():
            site_config.OCR_MODEL = request.data["ocr_model"]
        if "face_recognition_model" in request.data.keys():
            site_config.FACE_RECOGNITION_MODEL = request.data["face_recognition_model"]
        if "nextcloud_enabled" in request.data.keys():
            site_config.NEXTCLOUD_ENABLED = request.data["nextcloud_enabled"]
        if "auto_create_user_directory" in request.data.keys():
            site_config.AUTO_CREATE_USER_DIRECTORY = request.data[
                "auto_create_user_directory"
            ]
        if not do_all_models_exist():
            AsyncTask(download_models, User.objects.get(id=request.user.id)).run()

        return self.get(request, format=format)
