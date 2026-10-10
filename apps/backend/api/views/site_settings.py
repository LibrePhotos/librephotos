"""The admin-editable site settings endpoint (``/api/sitesettings``)."""

import jsonschema
from constance import config as site_config
from constance import settings as constance_settings
from django_q.tasks import Chain
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from api.mail import email_is_configured
from api.batch_jobs import queue_semantic_search_conversion
from api.ml_models import (
    do_all_models_exist,
    download_models,
    model_download_running,
    start_model_download,
)
from api.models import User
from api.schemas.site_settings import site_settings_schema
from api.semantic_search import semantic_search_model


def _site_config(*keys):
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
    def get_permissions(self):
        if self.request.method == "GET":
            self.permission_classes = (AllowAny,)
        else:
            self.permission_classes = (IsAdminUser,)

        return super(SiteSettingsView, self).get_permissions()

    def get(self, request, format=None):
        config = _site_config(
            "ALLOW_REGISTRATION",
            "ALLOW_UPLOAD",
            "SKIP_PATTERNS",
            "MAP_API_PROVIDER",
            "MAP_API_KEY",
            "MAP_TILE_PROVIDER",
            "CAPTIONING_MODEL",
            "TAGGING_MODEL",
            "SEMANTIC_SEARCH_MODEL",
            "OCR_MODEL",
            "FACE_RECOGNITION_MODEL",
            "NEXTCLOUD_ENABLED",
            "AUTO_CREATE_USER_DIRECTORY",
        )
        out = {}
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
        out["tagging_model"] = config["TAGGING_MODEL"]
        out["semantic_search_model"] = config["SEMANTIC_SEARCH_MODEL"]
        out["ocr_model"] = config["OCR_MODEL"]
        out["face_recognition_model"] = config["FACE_RECOGNITION_MODEL"]
        out["nextcloud_enabled"] = config["NEXTCLOUD_ENABLED"]
        out["auto_create_user_directory"] = config["AUTO_CREATE_USER_DIRECTORY"]
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
        search_model_changed = False
        if "semantic_search_model" in request.data.keys():
            new_model = request.data["semantic_search_model"]
            search_model_changed = new_model != semantic_search_model()
            site_config.SEMANTIC_SEARCH_MODEL = new_model
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
        admin = User.objects.get(id=request.user.id)
        if (
            search_model_changed
            and not do_all_models_exist()
            and not model_download_running()
        ):
            # Re-embed with the new model once its files are there.
            chain = Chain()
            chain.append(download_models, admin)
            chain.append(queue_semantic_search_conversion)
            chain.run()
        else:
            if not do_all_models_exist():
                # Not a new job per save: the settings form saves on every
                # toggle and blur, often while the first download is still
                # running, and parallel downloads write the same partial file.
                start_model_download(admin)
            if search_model_changed:
                # Every library's embeddings are re-made with the new model,
                # in place, with search following as they are converted.
                queue_semantic_search_conversion()

        return self.get(request, format=format)
