import io
import os
import subprocess
import uuid
import zipfile
from urllib.parse import quote

from api.batch_jobs import create_batch_job
import jsonschema
import magic
from constance import config as site_config
from django.conf import settings
from django.db.models import Q
from django.http import HttpResponse, HttpResponseForbidden, StreamingHttpResponse
from django.utils.decorators import method_decorator
from django.utils.encoding import iri_to_uri
from django.views.decorators.csrf import ensure_csrf_cookie
from django_q.tasks import AsyncTask
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import viewsets
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView, exception_handler
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken

from api.api_util import get_search_term_examples
from api.autoalbum import delete_missing_photos
from api.directory_watcher import scan_photos
from api.models import AlbumUser, Photo, User, LongRunningJob
from api.schemas.site_settings import site_settings_schema
from api.serializers.album_user import AlbumUserEditSerializer, AlbumUserListSerializer
from api.util import logger
from api.views.pagination import StandardResultsSetPagination
from api.ml_models import do_all_models_exist


def custom_exception_handler(exc, context):
    # Call REST framework's default exception handler first,
    # to get the standard error response.
    response = exception_handler(exc, context)

    # Update the structure of the response data.
    if response is not None:
        customized_response = {"errors": []}

        if isinstance(response.data, dict):
            for key, value in response.data.items():
                error = {"field": key, "message": "".join(str(value))}
                customized_response["errors"].append(error)
            response.data = customized_response

    return response


class AlbumUserEditViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumUserEditSerializer
    pagination_class = StandardResultsSetPagination

    def retrieve(self, *args, **kwargs):
        return super(AlbumUserEditViewSet, self).retrieve(*args, **kwargs)

    def list(self, *args, **kwargs):
        return super(AlbumUserEditViewSet, self).list(*args, **kwargs)

    def get_queryset(self):
        if self.request.user.is_anonymous:
            return AlbumUser.objects.none()
        return AlbumUser.objects.filter(owner=self.request.user).order_by("title")


# API Views
class SiteSettingsView(APIView):
    def get_permissions(self):
        if self.request.method == "GET":
            self.permission_classes = (AllowAny,)
        else:
            self.permission_classes = (IsAdminUser,)

        return super(SiteSettingsView, self).get_permissions()

    @method_decorator(ensure_csrf_cookie)
    def get(self, request, format=None):
        out = {}
        out["allow_registration"] = site_config.ALLOW_REGISTRATION
        out["allow_upload"] = site_config.ALLOW_UPLOAD
        out["skip_patterns"] = site_config.SKIP_PATTERNS
        out["heavyweight_process"] = site_config.HEAVYWEIGHT_PROCESS
        out["map_api_provider"] = site_config.MAP_API_PROVIDER
        out["map_api_key"] = site_config.MAP_API_KEY
        out["captioning_model"] = site_config.CAPTIONING_MODEL
        return Response(out)

    def post(self, request, format=None):
        jsonschema.validate(request.data, site_settings_schema)
        if "allow_registration" in request.data.keys():
            site_config.ALLOW_REGISTRATION = request.data["allow_registration"]
        if "allow_upload" in request.data.keys():
            site_config.ALLOW_UPLOAD = request.data["allow_upload"]
        if "skip_patterns" in request.data.keys():
            site_config.SKIP_PATTERNS = request.data["skip_patterns"]
        if "heavyweight_process" in request.data.keys():
            site_config.HEAVYWEIGHT_PROCESS = request.data["heavyweight_process"]
        if "map_api_provider" in request.data.keys():
            site_config.MAP_API_PROVIDER = request.data["map_api_provider"]
        if "map_api_key" in request.data.keys():
            site_config.MAP_API_KEY = request.data["map_api_key"]
        if "captioning_model" in request.data.keys():
            site_config.CAPTIONING_MODEL = request.data["captioning_model"]
        return self.get(request, format=format)


class SetUserAlbumShared(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        # print(data)
        shared = data["shared"]  # bool
        target_user_id = data["target_user_id"]  # user pk, int
        user_album_id = data["album_id"]

        try:
            target_user = User.objects.get(id=target_user_id)
        except User.DoesNotExist:
            logger.warning(
                "Cannot share album to user: target user_id {} does not exist".format(
                    target_user_id
                )
            )
            return Response(
                {"status": False, "message": "No such user"}, status_code=400
            )

        try:
            user_album_to_share = AlbumUser.objects.get(id=user_album_id)
        except AlbumUser.DoesNotExist:
            logger.warning(
                "Cannot share album to user: source user_album_id {} does not exist".format(
                    user_album_id
                )
            )
            return Response(
                {"status": False, "message": "No such album"}, status_code=400
            )

        if user_album_to_share.owner != request.user:
            logger.warning(
                "Cannot share album to user: source user_album_id {} does not belong to user_id {}".format(
                    user_album_id, request.user.id
                )
            )
            return Response(
                {"status": False, "message": "You cannot share an album you don't own"},
                status_code=400,
            )

        if shared:
            user_album_to_share.shared_to.add(target_user)
            logger.info(
                "Shared user {}'s album {} to user {}".format(
                    request.user.id, user_album_id, target_user_id
                )
            )
        else:
            user_album_to_share.shared_to.remove(target_user)
            logger.info(
                "Unshared user {}'s album {} to user {}".format(
                    request.user.id, user_album_id, target_user_id
                )
            )

        user_album_to_share.save()
        return Response(AlbumUserListSerializer(user_album_to_share).data)


# Utility views


class StorageStatsView(APIView):
    def get(self, request, format=None):
        import shutil

        total_storage, used_storage, free_storage = shutil.disk_usage("/")
        return Response(
            {
                "total_storage": total_storage,
                "used_storage": used_storage,
                "free_storage": free_storage,
            }
        )


class SearchTermExamples(APIView):
    def get(self, request, format=None):
        search_term_examples = get_search_term_examples(request.user)
        return Response({"results": search_term_examples})


# long running jobs
class ScanPhotosView(APIView):
    def get(self, request, format=None):
        if not do_all_models_exist():
            create_batch_job(LongRunningJob.JOB_DOWNLOAD_MODELS, request.user)
        try:
            job_id = uuid.uuid4()
            AsyncTask(
                scan_photos, request.user, False, job_id, request.user.scan_directory
            ).run()
            return Response({"status": True, "job_id": job_id})
        except BaseException:
            logger.exception("An Error occurred")
            return Response({"status": False})


# To-Do: Allow for custom paths
class SelectiveScanPhotosView(APIView):
    def get(self, request, format=None):
        if not do_all_models_exist():
            create_batch_job(LongRunningJob.JOB_DOWNLOAD_MODELS, request.user)
        # To-Do: Sanatize the scan_directory
        try:
            job_id = uuid.uuid4()
            AsyncTask(
                scan_photos,
                request.user,
                False,
                job_id,
                os.path.join(request.user.scan_directory, "uploads", "web"),
            ).run()
            return Response({"status": True, "job_id": job_id})
        except BaseException:
            logger.exception("An Error occurred")
            return Response({"status": False})


class FullScanPhotosView(APIView):
    def get(self, request, format=None):
        if not do_all_models_exist():
            create_batch_job(LongRunningJob.JOB_DOWNLOAD_MODELS, request.user)
        try:
            job_id = uuid.uuid4()
            AsyncTask(
                scan_photos, request.user, True, job_id, request.user.scan_directory
            ).run()
            return Response({"status": True, "job_id": job_id})
        except BaseException:
            logger.exception("An Error occurred")
            return Response({"status": False})


class DeleteMissingPhotosView(APIView):
    def get(self, request, format=None):
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
        return "protected_media/{}/{}".format(path, fname)

    # @silk_profile(name='media')
    def get(self, request, path, fname, format=None):
        jwt = request.COOKIES.get("jwt")
        image_hash = fname.split(".")[0].split("_")[0]
        try:
            photo = Photo.objects.get(image_hash=image_hash)
        except Photo.DoesNotExist:
            return HttpResponse(status=404)

        # grant access if the requested photo is public
        if photo.public:
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

        # grant access if the user is owner of the requested photo
        # or the photo is shared with the user
        image_hash = fname.split(".")[0].split("_")[0]  # janky alert
        user = User.objects.filter(id=token["user_id"]).only("id").first()
        if photo.owner == user or user in photo.shared_to.all():
            response = HttpResponse()
            response["Content-Type"] = "image/jpeg"
            response["X-Accel-Redirect"] = self._get_protected_media_url(path, fname)
            return response
        else:
            for album in photo.albumuser_set.only("shared_to"):
                if user in album.shared_to.all():
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
    for resp in iter(transcoder.process.stdout.readline, b""):
        yield resp


class MediaAccessFullsizeOriginalView(APIView):
    permission_classes = (AllowAny,)

    def _get_protected_media_url(self, path, fname):
        return "/protected_media{}/{}".format(path, fname)

    def _generate_response(self, photo, path, fname, transcode_videos):
        if "thumbnail" in path:
            response = HttpResponse()
            filename = os.path.splitext(photo.square_thumbnail.path)[1]
            if "jpg" in filename:
                # handle non migrated systems
                response["Content-Type"] = "image/jpg"
                response["X-Accel-Redirect"] = photo.thumbnail_big.path
            if "webp" in filename:
                response["Content-Type"] = "image/webp"
                response["X-Accel-Redirect"] = self._get_protected_media_url(
                    path, fname + ".webp"
                )
            if "mp4" in filename:
                response["Content-Type"] = "video/mp4"
                response["X-Accel-Redirect"] = self._get_protected_media_url(
                    path, fname + ".mp4"
                )
            return response
        if "faces" in path:
            response = HttpResponse()
            response["Content-Type"] = "image/jpg"
            response["X-Accel-Redirect"] = self._get_protected_media_url(path, fname)
            return response
        if photo.video:
            # This is probably very slow -> Save the mime type when scanning
            mime = magic.Magic(mime=True)
            filename = mime.from_file(photo.main_file.path)
            if transcode_videos:
                response = StreamingHttpResponse(
                    gen(VideoTranscoder(photo.main_file.path)),
                    content_type="video/mp4",
                )
                return response
            else:
                response = HttpResponse()
                response["Content-Type"] = filename
                response["X-Accel-Redirect"] = iri_to_uri(
                    photo.main_file.path.replace(settings.DATA_ROOT, "/original")
                )
                return response
        # faces and avatars
        response = HttpResponse()
        response["Content-Type"] = "image/jpg"
        response["X-Accel-Redirect"] = self._get_protected_media_url(path, fname)
        return response

    @extend_schema(
        description="Endpoint to load media files.",
        parameters=[
            OpenApiParameter(
                name="path",
                description="Kind of media file you want to load",
                required=True,
                type=OpenApiTypes.STR,
                enum=[
                    "thumbnails_big",
                    "square_thumbnails",
                    "small_square_thumbnails",
                    "avatars",
                    "photos",
                    "faces",
                    "embedded_media",
                ],
                location=OpenApiParameter.PATH,
            ),
            OpenApiParameter(
                name="fname",
                description="Usually the hash of the file. Faces have the format <hash>_<face_id>.jpg and avatars <first_name>avatar_<hash>.png",
                required=True,
                type=OpenApiTypes.STR,
                location=OpenApiParameter.PATH,
            ),
        ],
    )
    def get(self, request, path, fname, format=None):
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
                user = User.objects.filter(id=token["user_id"]).only("id").first()
                response = HttpResponse()
                response["Content-Type"] = "image/png"
                response["X-Accel-Redirect"] = "/protected_media/" + path + "/" + fname
                return response
            except Exception:
                return HttpResponse(status=404)
        if path.lower() == "embedded_media":
            jwt = request.COOKIES.get("jwt")
            query = Q(public=True)
            if request.user.is_authenticated:
                query = Q(owner=request.user)
            if (
                jwt is not None
            ):  # pragma: no cover, currently it's difficult to test requests with jwt in cookies
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
            response = HttpResponse()
            response["Content-Type"] = "video/mp4"
            response["X-Accel-Redirect"] = f"/protected_media/{path}/{fname}_1.mp4"
            return response
        if path.lower() != "photos":
            jwt = request.COOKIES.get("jwt")
            image_hash = fname.split(".")[0].split("_")[0]
            try:
                photo = Photo.objects.get(image_hash=image_hash)
            except Photo.DoesNotExist:
                return HttpResponse(status=404)

            # grant access if the requested photo is public
            if photo.public:
                return self._generate_response(photo, path, fname, False)

            # forbid access if trouble with jwt
            if jwt is not None:
                try:
                    token = AccessToken(jwt)
                except TokenError:
                    return HttpResponseForbidden()
            else:
                return HttpResponseForbidden()

            # grant access if the user is owner of the requested photo
            # or the photo is shared with the user
            image_hash = fname.split(".")[0].split("_")[0]  # janky alert
            user = (
                User.objects.filter(id=token["user_id"])
                .only("id", "transcode_videos")
                .first()
            )
            if photo.owner == user or user in photo.shared_to.all():
                return self._generate_response(
                    photo, path, fname, user.transcode_videos
                )
            else:
                for album in photo.albumuser_set.only("shared_to"):
                    if user in album.shared_to.all():
                        return self._generate_response(
                            photo, path, fname, user.transcode_videos
                        )
            return HttpResponse(status=404)
        else:
            jwt = request.COOKIES.get("jwt")
            image_hash = fname.split(".")[0].split("_")[0]
            try:
                photo = Photo.objects.get(image_hash=image_hash)
            except Photo.DoesNotExist:
                return HttpResponse(status=404)

            if photo.main_file.path.startswith("/nextcloud_media/"):
                internal_path = photo.main_file.path.replace(
                    "/nextcloud_media/", "/nextcloud_original/"
                )
                internal_path = "/nextcloud_original" + photo.main_file.path[21:]
            else:
                internal_path = "/original" + photo.main_file.path[5:]

            internal_path = quote(internal_path)

            # grant access if the requested photo is public
            if photo.public:
                response = HttpResponse()
                mime = magic.Magic(mime=True)
                filename = mime.from_file(photo.main_file.path)
                response["Content-Type"] = filename
                response["X-Accel-Redirect"] = internal_path
                return response

            # forbid access if trouble with jwt
            if jwt is not None:
                try:
                    token = AccessToken(jwt)
                except TokenError:
                    return HttpResponseForbidden()
            else:
                return HttpResponseForbidden()

            # grant access if the user is owner of the requested photo
            # or the photo is shared with the user
            image_hash = fname.split(".")[0].split("_")[0]  # janky alert
            user = User.objects.filter(id=token["user_id"]).only("id").first()
            if photo.owner == user or user in photo.shared_to.all():
                response = HttpResponse()
                mime = magic.Magic(mime=True)
                filename = mime.from_file(photo.main_file.path)
                response["Content-Type"] = filename
                response["X-Accel-Redirect"] = internal_path
                return response
            else:
                for album in photo.albumuser_set.only("shared_to"):
                    if user in album.shared_to.all():
                        response = HttpResponse()
                        mime = magic.Magic(mime=True)
                        filename = mime.from_file(photo.main_file.path)
                        response["Content-Type"] = filename
                        response["X-Accel-Redirect"] = internal_path
                        return response
            return HttpResponse(status=404)


class ZipListPhotosView(APIView):
    def post(self, request, format=None):
        try:
            data = dict(request.data)
            if "image_hashes" not in data:
                return
            photos = Photo.objects.filter(owner=self.request.user).in_bulk(
                data["image_hashes"]
            )
            if len(photos) == 0:
                return
            mf = io.BytesIO()
            photos_name = {}
            for photo in photos.values():
                photo_name = os.path.basename(photo.main_file.path)
                if photo_name in photos_name:
                    photos_name[photo_name] = photos_name[photo_name] + 1
                    photo_name = str(photos_name[photo_name]) + "-" + photo_name
                else:
                    photos_name[photo_name] = 1
                with zipfile.ZipFile(
                    mf, mode="a", compression=zipfile.ZIP_DEFLATED
                ) as zf:
                    zf.write(photo.main_file.path, arcname=photo_name)
            return HttpResponse(
                mf.getvalue(), content_type="application/x-zip-compressed"
            )
        except BaseException as e:
            logger.error(str(e))
            return HttpResponse(status=404)
