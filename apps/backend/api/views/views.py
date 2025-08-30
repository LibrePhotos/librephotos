import os
import subprocess
import uuid
from urllib.parse import quote

import jsonschema
import magic
from constance import config as site_config
from django.conf import settings
from django.db.models import Q, Sum
from django.http import (
    FileResponse,
    HttpResponse,
    HttpResponseForbidden,
    StreamingHttpResponse,
)
from django.utils.decorators import method_decorator
from django.utils.encoding import iri_to_uri
from django.utils import timezone
from django.views.decorators.cache import cache_page
from django.views.decorators.vary import vary_on_cookie
from django_q.tasks import AsyncTask, Chain
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView, exception_handler
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken

from api.all_tasks import create_download_job, delete_zip_file
from api.api_util import get_search_term_examples
from api.autoalbum import delete_missing_photos
from api.directory_watcher import scan_photos
from api.ml_models import do_all_models_exist, download_models
from api.models import AlbumUser, LongRunningJob, Photo, User
from api.schemas.site_settings import site_settings_schema
from api.serializers.album_user import AlbumUserEditSerializer, AlbumUserListSerializer
from api.util import logger
from api.views.pagination import StandardResultsSetPagination


def custom_exception_handler(exc, context):
    # Call REST framework's default exception handler first,
    # to get the standard error response.
    response = exception_handler(exc, context)

    # Update the structure of the response data and enrich auth errors.
    if response is not None:
        customized_response = {"errors": []}

        if isinstance(response.data, dict):
            for key, value in response.data.items():
                error = {"field": key, "message": "".join(str(value))}
                customized_response["errors"].append(error)

        # Add actionable guidance for unauthenticated/forbidden responses
        if getattr(response, "status_code", None) in (401, 403) and settings.DEBUG:
            customized_response["errors"].append(
                {
                    "field": "auth",
                    "message": (
                        "Authentication required. Obtain a JWT via POST /api/auth/token/obtain/ "
                        'with JSON {"username":"<user>", "password":"<pass>"}. '
                        "Then call APIs with header Authorization: Bearer <access_token> (or use the 'jwt' cookie set by the obtain/refresh endpoints). "
                        "See /api/help and docs at https://docs.librephotos.com/docs/user-guide/api-authentication."
                    ),
                }
            )

        response.data = customized_response

    return response


class AlbumUserEditViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumUserEditSerializer
    pagination_class = StandardResultsSetPagination

    def retrieve(self, *args, **kwargs):
        return super().retrieve(*args, **kwargs)

    def list(self, *args, **kwargs):
        return super().list(*args, **kwargs)

    def get_queryset(self):
        if self.request.user.is_anonymous:
            return AlbumUser.objects.none()
        return AlbumUser.objects.filter(owner=self.request.user).order_by("title")

    def get_permissions(self):
        if self.action in ["list", "retrieve"]:
            self.permission_classes = (IsAuthenticated,)
        else:
            self.permission_classes = (IsAuthenticated,)

        return super().get_permissions()


# API Views
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
        out["captioning_model"] = site_config.CAPTIONING_MODEL
        out["llm_model"] = site_config.LLM_MODEL
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
        if "captioning_model" in request.data.keys():
            site_config.CAPTIONING_MODEL = request.data["captioning_model"]
        if "llm_model" in request.data.keys():
            site_config.LLM_MODEL = request.data["llm_model"]
        if not do_all_models_exist():
            AsyncTask(download_models, User.objects.get(id=request.user.id)).run()

        return self.get(request, format=format)


class SetUserAlbumShared(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        shared = data["shared"]  # bool
        target_user_id = data["target_user_id"]  # user pk, int
        user_album_id = data["album_id"]

        try:
            target_user = User.objects.get(id=target_user_id)
        except User.DoesNotExist:
            logger.warning(
                f"Cannot share album to user: target user_id {target_user_id} does not exist"
            )
            return Response(
                {"status": False, "message": "No such user"}, status_code=400
            )

        try:
            user_album_to_share = AlbumUser.objects.get(id=user_album_id)
        except AlbumUser.DoesNotExist:
            logger.warning(
                f"Cannot share album to user: source user_album_id {user_album_id} does not exist"
            )
            return Response(
                {"status": False, "message": "No such album"}, status_code=400
            )

        if user_album_to_share.owner != request.user:
            logger.warning(
                f"Cannot share album to user: source user_album_id {user_album_id} does not belong to user_id {request.user.id}"
            )
            return Response(
                {"status": False, "message": "You cannot share an album you don't own"},
                status_code=400,
            )

        if shared:
            user_album_to_share.shared_to.add(target_user)
            logger.info(
                f"Shared user {request.user.id}'s album {user_album_id} to user {target_user_id}"
            )
        else:
            user_album_to_share.shared_to.remove(target_user)
            logger.info(
                f"Unshared user {request.user.id}'s album {user_album_id} to user {target_user_id}"
            )

        user_album_to_share.save()
        return Response(AlbumUserListSerializer(user_album_to_share).data)


# Utility views


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


class ImageTagView(APIView):
    @method_decorator(cache_page(60 * 60 * 2))
    def get(self, request, format=None):
        # Add an exception for the directory '/code'
        subprocess.run(
            ["git", "config", "--global", "--add", "safe.directory", "/code"],
            check=False,
        )

        # Get the current commit hash
        git_hash = (
            subprocess.check_output(["git", "rev-parse", "--short", "HEAD"])
            .strip()
            .decode("utf-8")
        )
        return Response(
            {"image_tag": os.environ.get("IMAGE_TAG", ""), "git_hash": git_hash}
        )


class SearchTermExamples(APIView):
    @method_decorator(vary_on_cookie)
    @method_decorator(cache_page(60 * 60 * 2))
    def get(self, request, format=None):
        search_term_examples = get_search_term_examples(request.user)
        return Response({"results": search_term_examples})


# long running jobs
class ScanPhotosView(APIView):
    def post(self, request, format=None):
        return self._scan_photos(request)

    @extend_schema(
        deprecated=True,
        description="Use POST method instead",
    )
    def get(self, request, format=None):
        return self._scan_photos(request)

    def _scan_photos(self, request):
        # Validate that user has a configured scan directory
        if not request.user.scan_directory or request.user.scan_directory.strip() == "":
            return Response(
                {
                    "status": False,
                    "message": "Scan failed: No scan directory configured. Please contact your administrator to set up a scan directory for your account.",
                },
                status=400,
            )

        # Validate that the scan directory exists
        if not os.path.exists(request.user.scan_directory):
            return Response(
                {
                    "status": False,
                    "message": f"Scan failed: Scan directory '{request.user.scan_directory}' does not exist. Please contact your administrator.",
                },
                status=400,
            )

        chain = Chain()
        if not do_all_models_exist():
            chain.append(download_models, request.user)
        try:
            job_id = uuid.uuid4()
            chain.append(
                scan_photos, request.user, False, job_id, request.user.scan_directory
            )
            chain.run()
            return Response({"status": True, "job_id": job_id})
        except BaseException:
            logger.exception("An Error occurred")
            return Response({"status": False})


# To-Do: Allow for custom paths
class SelectiveScanPhotosView(APIView):
    def get(self, request, format=None):
        # Validate that user has a configured scan directory
        if not request.user.scan_directory or request.user.scan_directory.strip() == "":
            return Response(
                {
                    "status": False,
                    "message": "Scan failed: No scan directory configured. Please contact your administrator to set up a scan directory for your account.",
                },
                status=400,
            )

        # Validate that the scan directory exists
        if not os.path.exists(request.user.scan_directory):
            return Response(
                {
                    "status": False,
                    "message": f"Scan failed: Scan directory '{request.user.scan_directory}' does not exist. Please contact your administrator.",
                },
                status=400,
            )

        chain = Chain()
        if not do_all_models_exist():
            chain.append(download_models, request.user)
        # To-Do: Sanatize the scan_directory
        try:
            job_id = uuid.uuid4()
            chain.append(
                scan_photos,
                request.user,
                False,
                job_id,
                os.path.join(request.user.scan_directory, "uploads", "web"),
            )
            chain.run()
            return Response({"status": True, "job_id": job_id})
        except BaseException:
            logger.exception("An Error occurred")
            return Response({"status": False})


class FullScanPhotosView(APIView):
    def post(self, request, format=None):
        return self._scan_photos(request)

    @extend_schema(
        deprecated=True,
        description="Use POST method instead",
    )
    def get(self, request, format=None):
        return self._scan_photos(request)

    def _scan_photos(self, request):
        chain = Chain()
        if not do_all_models_exist():
            chain.append(download_models, request.user)
        try:
            job_id = uuid.uuid4()
            chain.append(
                scan_photos, request.user, True, job_id, request.user.scan_directory
            )
            chain.run()
            return Response({"status": True, "job_id": job_id})
        except BaseException:
            logger.exception("An Error occurred")
            return Response({"status": False})


class DeleteMissingPhotosView(APIView):
    def post(self, request, format=None):
        return self._delete_missing_photos(request, format)

    @extend_schema(
        deprecated=True,
        description="Use POST method instead",
    )
    def get(self, request, format=None):
        return self._delete_missing_photos(request, format)

    def _delete_missing_photos(self, request, format=None):
        try:
            job_id = uuid.uuid4()
            delete_missing_photos(request.user, job_id)
            return Response({"status": True, "job_id": job_id})
        except BaseException:
            logger.exception("An Error occurred")
            return Response({"status": False})


class MediaAccessView(APIView):
    permission_classes = (AllowAny,)

    def _get_protected_media_url(self, path, fname):
        return f"protected_media/{path}/{fname}"

    # @silk_profile(name='media')
    def get(self, request, path, fname, format=None):
        jwt = request.COOKIES.get("jwt")
        image_hash = fname.split(".")[0].split("_")[0]
        try:
            photo = Photo.objects.get(image_hash=image_hash)
        except Photo.DoesNotExist:
            return HttpResponse(status=404)

        # grant access if the requested photo is public or part of any public user album
        if photo.public or photo.albumuser_set.filter(public=True).exists():
            response = HttpResponse()
            response["Content-Type"] = "image/jpeg"
            response["X-Accel-Redirect"] = self._get_protected_media_url(path, fname)
            return response

        # forbid access if trouble with jwt
        if jwt is not None:
            try:
                token = AccessToken(jwt)
            except TokenError:
                return HttpResponseForbidden()
        else:
            return HttpResponseForbidden()

        # grant access if the user is owner of the requested photo,
        # the photo is shared with the user, or the photo belongs to a public user album
        image_hash = fname.split(".")[0].split("_")[0]  # janky alert
        user = User.objects.filter(id=token["user_id"]).only("id").first()
        if photo.owner == user or user in photo.shared_to.all():
            response = HttpResponse()
            response["Content-Type"] = "image/jpeg"
            response["X-Accel-Redirect"] = self._get_protected_media_url(path, fname)
            return response
        else:
            for album in photo.albumuser_set.only("shared_to", "public"):
                if album.public or user in album.shared_to.all():
                    response = HttpResponse()
                    response["Content-Type"] = "image/jpeg"
                    response["X-Accel-Redirect"] = self._get_protected_media_url(
                        path, fname
                    )
                    return response
        return HttpResponse(status=404)


class VideoTranscoder:
    process = ""

    def __init__(self, path):
        ffmpeg_command = [
            "ffmpeg",
            "-i",
            path,
            "-vcodec",
            "libx264",
            "-preset",
            "ultrafast",
            "-movflags",
            "frag_keyframe+empty_moov",
            "-filter:v",
            ("scale=-2:" + str(720)),
            "-f",
            "mp4",
            "-",
        ]
        self.process = subprocess.Popen(
            ffmpeg_command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )

    def __del__(self):
        self.process.kill()


def gen(transcoder):
    yield from iter(transcoder.process.stdout.readline, b"")


class UnifiedMediaAccessView(APIView):
    """
    Unified media access endpoint supporting both proxy and no-proxy setups,
    and handling public album media access.
    """

    permission_classes = (AllowAny,)

    def _should_use_proxy(self):
        return not getattr(settings, "SERVE_FRONTEND", False)

    def _protected_media_url(self, path, fname):
        path = path.lstrip("/")
        return f"/protected_media/{path}/{fname}"

    def _serve_file_direct(self, file_path, content_type=None):
        if not os.path.exists(file_path):
            return HttpResponse(status=404)
        try:
            response = FileResponse(open(file_path, "rb"))
            if content_type:
                response["Content-Type"] = content_type
            else:
                try:
                    mime = magic.Magic(mime=True)
                    response["Content-Type"] = mime.from_file(file_path)
                except Exception:
                    response["Content-Type"] = "application/octet-stream"
            return response
        except (FileNotFoundError, PermissionError):
            return HttpResponse(status=404)
        except Exception:
            return HttpResponse(status=500)

    def _generate_response_proxy(self, photo, path, fname, transcode_videos):
        if "thumbnail" in path:
            response = HttpResponse()
            ext = (
                os.path.splitext(getattr(photo.thumbnail, "square_thumbnail").path)[1]
                if hasattr(photo, "thumbnail")
                else ""
            )
            if "jpg" in ext:
                response["Content-Type"] = "image/jpg"
                response["X-Accel-Redirect"] = getattr(
                    photo.thumbnail, "thumbnail_big", photo.thumbnail.square_thumbnail
                ).path
            if "webp" in ext:
                response["Content-Type"] = "image/webp"
                response["X-Accel-Redirect"] = self._protected_media_url(
                    path, fname + ".webp"
                )
            if "mp4" in ext:
                response["Content-Type"] = "video/mp4"
                response["X-Accel-Redirect"] = self._protected_media_url(
                    path, fname + ".mp4"
                )
            return response

        if "faces" in path:
            response = HttpResponse()
            response["Content-Type"] = "image/jpg"
            response["X-Accel-Redirect"] = self._protected_media_url(path, fname)
            return response

        if photo.video:
            mime = magic.Magic(mime=True)
            filename = mime.from_file(photo.main_file.path)
            if transcode_videos:
                response = StreamingHttpResponse(
                    gen(VideoTranscoder(photo.main_file.path)),
                    content_type="video/mp4",
                )
                return response
            response = HttpResponse()
            response["Content-Type"] = filename
            response["X-Accel-Redirect"] = iri_to_uri(
                photo.main_file.path.replace(settings.DATA_ROOT, "/original")
            )
            return response

        response = HttpResponse()
        response["Content-Type"] = "image/jpg"
        response["X-Accel-Redirect"] = self._protected_media_url(path, fname)
        return response

    def _generate_response_direct(self, photo, path, fname, transcode_videos):
        if "thumbnail" in path:
            file_path = os.path.join(settings.MEDIA_ROOT, path, fname)
            if not os.path.exists(file_path):
                if not fname.endswith(".webp"):
                    webp = os.path.join(settings.MEDIA_ROOT, path, fname + ".webp")
                    if os.path.exists(webp):
                        return self._serve_file_direct(webp, "image/webp")
                if not fname.endswith(".mp4"):
                    mp4 = os.path.join(settings.MEDIA_ROOT, path, fname + ".mp4")
                    if os.path.exists(mp4):
                        return self._serve_file_direct(mp4, "video/mp4")
            if hasattr(photo, "thumbnail"):
                ext = os.path.splitext(photo.thumbnail.square_thumbnail.path)[1]
                if "jpg" in ext:
                    return self._serve_file_direct(
                        photo.thumbnail.thumbnail_big.path, "image/jpg"
                    )
            return self._serve_file_direct(file_path)

        if "faces" in path:
            file_path = os.path.join(settings.MEDIA_ROOT, path, fname)
            return self._serve_file_direct(file_path, "image/jpg")

        if photo.video:
            return self._serve_file_direct(photo.main_file.path)

        file_path = os.path.join(settings.MEDIA_ROOT, path, fname)
        return self._serve_file_direct(file_path, "image/jpg")

    def _public_album_active_q(self):
        return Q(share__enabled=True) & (
            Q(share__expires_at__isnull=True) | Q(share__expires_at__gte=timezone.now())
        )

    def get(self, request, path, fname, album_id=None, format=None):
        use_proxy = self._should_use_proxy()

        # ZIP files
        if path.lower() == "zip":
            jwt = request.COOKIES.get("jwt")
            if jwt is not None:
                try:
                    token = AccessToken(jwt)
                except TokenError:
                    return HttpResponseForbidden()
            else:
                return HttpResponseForbidden()
            try:
                filename = fname + str(token["user_id"]) + ".zip"
                if use_proxy:
                    response = HttpResponse()
                    response["Content-Type"] = "application/x-zip-compressed"
                    response["X-Accel-Redirect"] = self._protected_media_url(
                        path, filename
                    )
                    return response
                file_path = os.path.join(settings.MEDIA_ROOT, path, filename)
                return self._serve_file_direct(
                    file_path, "application/x-zip-compressed"
                )
            except Exception:
                return HttpResponseForbidden()

        # Avatars
        if path.lower() == "avatars":
            jwt = request.COOKIES.get("jwt")
            if jwt is not None:
                try:
                    token = AccessToken(jwt)
                except TokenError:
                    return HttpResponseForbidden()
            else:
                return HttpResponseForbidden()
            try:
                _ = User.objects.filter(id=token["user_id"]).only("id").first()
                if use_proxy:
                    response = HttpResponse()
                    response["Content-Type"] = "image/png"
                    response["X-Accel-Redirect"] = self._protected_media_url(
                        path, fname
                    )
                    return response
                file_path = os.path.join(settings.MEDIA_ROOT, path, fname)
                return self._serve_file_direct(file_path, "image/png")
            except Exception:
                return HttpResponse(status=404)

        # Embedded media
        if path.lower() == "embedded_media":
            jwt = request.COOKIES.get("jwt")
            query = Q(public=True)
            if request.user.is_authenticated:
                query = Q(owner=request.user)
            if jwt is not None:  # pragma: no cover
                try:
                    token = AccessToken(jwt)
                    user = User.objects.filter(id=token["user_id"]).only("id").first()
                    query = Q(owner=user)
                except TokenError:
                    pass
            try:
                photo = Photo.objects.filter(query, image_hash=fname).first()
                if not photo or photo.main_file.embedded_media.count() < 1:
                    raise Photo.DoesNotExist()
            except Photo.DoesNotExist:
                return HttpResponse(status=404)
            if use_proxy:
                response = HttpResponse()
                response["Content-Type"] = "video/mp4"
                response["X-Accel-Redirect"] = self._protected_media_url(
                    path, fname + "_1.mp4"
                )
                return response
            file_path = os.path.join(settings.MEDIA_ROOT, path, fname + "_1.mp4")
            return self._serve_file_direct(file_path, "video/mp4")

        # Determine photo by hash
        image_hash = fname.split(".")[0].split("_")[0]

        # Public album access
        if album_id is not None:
            album = (
                AlbumUser.objects.filter(id=album_id)
                .filter(self._public_album_active_q())
                .first()
            )
            if album is None:
                return HttpResponse(status=404)
            try:
                photo = album.photos.only(
                    "image_hash", "video", "main_file", "thumbnail"
                ).get(image_hash=image_hash)
            except Photo.DoesNotExist:
                return HttpResponse(status=404)

            if "thumbnail" in path or "thumbnails" in path or "faces" in path:
                if use_proxy:
                    return self._generate_response_proxy(photo, path, fname, False)
                return self._generate_response_direct(photo, path, fname, False)

            if use_proxy:
                response = HttpResponse()
                try:
                    mime = magic.Magic(mime=True)
                    filename = mime.from_file(photo.main_file.path)
                except Exception:
                    filename = "application/octet-stream"
                response["Content-Type"] = filename if photo.video else "image/webp"
                if photo.main_file.path.startswith(settings.PHOTOS):
                    internal_path = (
                        "/original" + photo.main_file.path[len(settings.PHOTOS) :]
                    )
                else:
                    internal_path = photo.main_file.path
                response["X-Accel-Redirect"] = iri_to_uri(internal_path)
                return response
            try:
                mime = magic.Magic(mime=True)
                content_type = mime.from_file(photo.main_file.path)
            except Exception:
                content_type = "application/octet-stream"
            return self._serve_file_direct(
                photo.main_file.path, content_type if photo.video else "image/webp"
            )

        # Non-photos (thumbnails, faces, etc.)
        if path.lower() != "photos":
            try:
                photo = Photo.objects.get(image_hash=image_hash)
            except Photo.DoesNotExist:
                return HttpResponse(status=404)

            if photo.albumuser_set.filter(self._public_album_active_q()).exists():
                if use_proxy:
                    return self._generate_response_proxy(photo, path, fname, False)
                return self._generate_response_direct(photo, path, fname, False)

            jwt = request.COOKIES.get("jwt")
            if jwt is not None:
                try:
                    token = AccessToken(jwt)
                except TokenError:
                    return HttpResponseForbidden()
            else:
                return HttpResponseForbidden()

            user = (
                User.objects.filter(id=token["user_id"])
                .only("id", "transcode_videos")
                .first()
            )
            if photo.owner == user or user in photo.shared_to.all():
                if use_proxy:
                    return self._generate_response_proxy(
                        photo, path, fname, user.transcode_videos
                    )
                return self._generate_response_direct(
                    photo, path, fname, user.transcode_videos
                )
            else:
                for album in photo.albumuser_set.only("shared_to", "public"):
                    if getattr(album, "public", False) or user in album.shared_to.all():
                        if use_proxy:
                            return self._generate_response_proxy(
                                photo, path, fname, user.transcode_videos
                            )
                        return self._generate_response_direct(
                            photo, path, fname, user.transcode_videos
                        )
            return HttpResponse(status=404)

        # Original photos (path == photos)
        try:
            photo = Photo.objects.get(image_hash=image_hash)
        except Photo.DoesNotExist:
            return HttpResponse(status=404)

        if photo.albumuser_set.filter(self._public_album_active_q()).exists():
            if use_proxy:
                try:
                    mime = magic.Magic(mime=True)
                    filename = mime.from_file(photo.main_file.path)
                except Exception:
                    filename = "application/octet-stream"
                response = HttpResponse()
                response["Content-Type"] = filename if photo.video else "image/webp"
                if photo.main_file.path.startswith("/nextcloud_media/"):
                    internal_path = "/nextcloud_original" + photo.main_file.path[21:]
                elif photo.main_file.path.startswith(settings.PHOTOS):
                    internal_path = (
                        "/original" + photo.main_file.path[len(settings.PHOTOS) :]
                    )
                else:
                    internal_path = quote(photo.main_file.path)
                response["X-Accel-Redirect"] = internal_path
                return response
            try:
                mime = magic.Magic(mime=True)
                content_type = mime.from_file(photo.main_file.path)
            except Exception:
                content_type = "application/octet-stream"
            return self._serve_file_direct(photo.main_file.path, content_type)

        jwt = request.COOKIES.get("jwt")
        if jwt is not None:
            try:
                token = AccessToken(jwt)
            except TokenError:
                return HttpResponseForbidden()
        else:
            return HttpResponseForbidden()

        user = User.objects.filter(id=token["user_id"]).only("id").first()
        if photo.owner == user or user in photo.shared_to.all():
            if use_proxy:
                response = HttpResponse()
                try:
                    mime = magic.Magic(mime=True)
                    filename = mime.from_file(photo.main_file.path)
                except Exception:
                    filename = "application/octet-stream"
                response["Content-Type"] = filename if photo.video else "image/webp"
                if photo.main_file.path.startswith("/nextcloud_media/"):
                    internal_path = "/nextcloud_original" + photo.main_file.path[21:]
                elif photo.main_file.path.startswith(settings.PHOTOS):
                    internal_path = (
                        "/original" + photo.main_file.path[len(settings.PHOTOS) :]
                    )
                else:
                    internal_path = quote(photo.main_file.path)
                response["Content-Disposition"] = 'inline; filename="{}"'.format(
                    photo.main_file.path.split("/")[-1]
                )
                response["X-Accel-Redirect"] = internal_path
                return response
            return self._serve_file_direct(photo.main_file.path)
        else:
            for album in photo.albumuser_set.only("shared_to", "public"):
                if getattr(album, "public", False) or user in album.shared_to.all():
                    if use_proxy:
                        response = HttpResponse()
                        try:
                            mime = magic.Magic(mime=True)
                            filename = mime.from_file(photo.main_file.path)
                        except Exception:
                            filename = "application/octet-stream"
                        response["Content-Type"] = (
                            filename if photo.video else "image/webp"
                        )
                        if photo.main_file.path.startswith("/nextcloud_media/"):
                            internal_path = (
                                "/nextcloud_original" + photo.main_file.path[21:]
                            )
                        elif photo.main_file.path.startswith(settings.PHOTOS):
                            internal_path = (
                                "/original"
                                + photo.main_file.path[len(settings.PHOTOS) :]
                            )
                        else:
                            internal_path = quote(photo.main_file.path)
                        response["X-Accel-Redirect"] = internal_path
                        return response
                    return self._serve_file_direct(photo.main_file.path)
        return HttpResponse(status=404)


class ZipListPhotosView_V2(APIView):
    def post(self, request):
        import shutil

        free_storage = shutil.disk_usage("/").free
        data = dict(request.data)
        if "image_hashes" not in data:
            return
        photo_query = Photo.objects.filter(owner=self.request.user)
        # Filter photos based on image hashes
        photos = photo_query.filter(image_hash__in=data["image_hashes"])
        if not photos.exists():
            return

        # Calculate the total file size using aggregate
        total_file_size = photos.aggregate(Sum("size"))["size__sum"] or 0
        if free_storage < total_file_size:
            return Response(data={"status": "Insufficient Storage"}, status=507)
        file_uuid = uuid.uuid4()
        filename = str(str(file_uuid) + str(self.request.user.id) + ".zip")

        job_id = create_download_job(
            LongRunningJob.JOB_DOWNLOAD_PHOTOS,
            user=self.request.user,
            photos=list(photos),
            filename=filename,
        )
        response = {"job_id": job_id, "url": file_uuid}

        return Response(data=response, status=200)

    def get(self, request):
        job_id = request.GET["job_id"]
        print(job_id)
        if job_id is None:
            return Response(status=404)
        try:
            job = LongRunningJob.objects.get(job_id=job_id)
            if job.finished:
                return Response(data={"status": "SUCCESS"}, status=200)
            elif job.failed:
                return Response(
                    data={"status": "FAILURE", "result": job.result}, status=500
                )
            else:
                return Response(
                    data={"status": "PENDING", "progress": job.result}, status=202
                )
        except BaseException as e:
            logger.error(str(e))
            return Response(status=404)


class DeleteZipView(APIView):
    def delete(self, request, fname):
        jwt = request.COOKIES.get("jwt")
        if jwt is not None:
            try:
                token = AccessToken(jwt)
            except TokenError:
                return HttpResponseForbidden()
        else:
            return HttpResponseForbidden()
        filename = fname + str(token["user_id"]) + ".zip"
        try:
            delete_zip_file(filename)
            return Response(status=200)
        except BaseException as e:
            logger.error(str(e))
            return Response(status=404)
