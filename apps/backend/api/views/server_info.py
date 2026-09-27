"""What the server can say about itself: storage, API help and build tag."""

import functools
import os
import subprocess

from django.conf import settings
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


class StorageStatsView(APIView):
    def get(self, request, format=None):
        import shutil

        total_storage, used_storage, free_storage = shutil.disk_usage(
            settings.DATA_ROOT
        )
        return Response(
            {
                "total_storage": total_storage,
                "used_storage": used_storage,
                "free_storage": free_storage,
            }
        )


class ApiHelpView(APIView):
    permission_classes = (AllowAny,)

    def get(self, request, format=None):
        base = ""
        try:
            base = request.build_absolute_uri("/").rstrip("/")
        except Exception:
            base = ""

        data = {
            "about": "LibrePhotos API Help",
            "authentication": {
                "default_authentication_classes": [
                    "rest_framework_simplejwt.authentication.JWTAuthentication",
                    "rest_framework.authentication.BasicAuthentication",
                ],
                "jwt": {
                    "obtain": f"{base}/api/auth/token/obtain/",
                    "refresh": f"{base}/api/auth/token/refresh/",
                    "how_to": "POST username and password as JSON to obtain, then send Authorization: Bearer <access_token> or rely on 'jwt' cookie set by obtain/refresh endpoints.",
                },
                "basic": {
                    "how_to": "Send Authorization: Basic base64(username:password).",
                },
            },
            "useful_endpoints": {
                "api_root": f"{base}/",  # browsable API may be disabled when serving frontend
                "help": f"{base}/api/help",
                "photos": f"{base}/api/photos/",
                "search": f"{base}/api/photos/searchlist/",
            },
            "documentation": {
                "api_authentication": "https://docs.librephotos.com/docs/user-guide/api-authentication",
            },
            "examples": {
                "obtain_token_curl": (
                    "curl -X POST \"{base}/api/auth/token/obtain/\" -H 'Content-Type: application/json' "
                    "-d '{"
                    "username"
                    ": "
                    "myuser"
                    ", "
                    "password"
                    ": "
                    "mypassword"
                    "}'"
                ),
                "call_api_with_bearer": (
                    "curl -H 'Authorization: Bearer <access_token>' \"{base}/api/photos/\""
                ),
                "call_api_with_basic": (
                    'curl -u myuser:mypassword "{base}/api/photos/"'
                ),
            },
        }

        # Add schema links in DEBUG mode if available
        try:
            if settings.DEBUG:
                data.setdefault("useful_endpoints", {}).update(
                    {
                        "openapi_schema": f"{base}/api/schema",
                        "swagger_ui": f"{base}/api/swagger",
                        "redoc": f"{base}/api/redoc",
                    }
                )
        except Exception:
            pass

        return Response(data)


@functools.lru_cache(maxsize=1)
def read_git_hash():
    """The commit this backend was built from.

    The images are built without ``.git``, so ``GIT_HASH`` (a build argument of
    the backend Dockerfiles) is the answer there. A source checkout falls back
    to asking git. ``-c safe.directory=...`` covers the case the old code
    papered over with ``git config --global --add safe.directory /code`` on
    every request - a checkout owned by another user - but only for this one
    command, instead of appending another line to the global git config each
    time. Cached for the life of the process: the answer cannot change under it.
    """
    git_hash = os.environ.get("GIT_HASH", "").strip()
    if git_hash:
        return git_hash
    backend_root = os.path.dirname(str(settings.BASE_DIR))
    try:
        return (
            subprocess.check_output(
                [
                    "git",
                    "-c",
                    f"safe.directory={backend_root}",
                    "rev-parse",
                    "--short",
                    "HEAD",
                ],
                cwd=backend_root,
                stderr=subprocess.DEVNULL,
                timeout=5,
            )
            .strip()
            .decode("utf-8")
        )
    except Exception:
        return os.environ.get("IMAGE_TAG") or "unknown"


class ImageTagView(APIView):
    def get(self, request, format=None):
        return Response(
            {"image_tag": os.environ.get("IMAGE_TAG", ""), "git_hash": read_git_hash()}
        )
