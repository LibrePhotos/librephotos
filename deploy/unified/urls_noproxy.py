"""librephotos URL Configuration for No-Proxy Setup

This configuration serves both the API and the frontend from Django
"""

import os
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import HttpResponse, HttpResponseForbidden, FileResponse
from django.urls import include, re_path
from django.views.generic import TemplateView
from rest_framework import routers
from rest_framework_simplejwt.serializers import (
    TokenObtainPairSerializer,
    TokenRefreshSerializer,
)
from rest_framework_simplejwt.views import (
    TokenBlacklistView,
    TokenObtainPairView,
    TokenRefreshView,
)
from rest_framework_simplejwt.tokens import AccessToken
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework.permissions import AllowAny
from rest_framework.views import APIView

from api.views import (
    album_auto,
    albums,
    dataviz,
    faces,
    jobs,
    photos,
    search,
    services,
    sharing,
    timezone,
    upload,
    user,
    views,
)
from api.models import Photo, User
from nextcloud import views as nextcloud_views
import os
import magic
from django.db.models import Q


class CustomTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super(TokenObtainPairSerializer, cls).get_token(user)

        token["name"] = user.get_username()
        token["is_admin"] = user.is_superuser
        token["first_name"] = user.first_name
        token["last_name"] = user.last_name
        token["scan_directory"] = user.scan_directory
        token["confidence"] = user.confidence
        token["semantic_search_topk"] = user.semantic_search_topk
        token["nextcloud_server_address"] = user.nextcloud_server_address
        token["nextcloud_username"] = user.nextcloud_username

        return token


class CustomTokenObtainPairView(TokenObtainPairView):
    serializer_class = CustomTokenObtainPairSerializer

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        response.set_cookie("jwt", response.data["access"])
        response["Access-Control-Allow-Credentials"] = "true"
        return response


class CustomTokenRefreshView(TokenRefreshView):
    serializer_class = TokenRefreshSerializer

    def post(self, request, *args, **kwargs):
        response = super().post(request, *args, **kwargs)
        response.set_cookie("jwt", response.data["access"])
        response["Access-Control-Allow-Credentials"] = "true"
        return response


class FrontendView(TemplateView):
    """
    Serves the frontend index.html for all non-API routes
    """
    def get(self, request, *args, **kwargs):
        try:
            # The frontend_build is at /code/frontend_build, but BASE_DIR is /code/librephotos
            # So we need to go up one level from BASE_DIR
            frontend_path = os.path.join(os.path.dirname(settings.BASE_DIR), 'frontend_build', 'index.html')
            with open(frontend_path) as f:
                return HttpResponse(f.read(), content_type='text/html')
        except FileNotFoundError:
            return HttpResponse(
                'Frontend build not found. Please build the frontend first.',
                status=500
            )


class NoProxyMediaAccessView(APIView):
    """
    Media access view for no-proxy setup that serves files directly
    instead of using X-Accel-Redirect headers
    """
    permission_classes = (AllowAny,)

    def _serve_file_direct(self, file_path, content_type=None):
        """Serve file directly from Django"""
        if not os.path.exists(file_path):
            return HttpResponse(status=404)
        
        try:
            response = FileResponse(open(file_path, 'rb'))
            
            if content_type:
                response['Content-Type'] = content_type
            elif file_path.endswith('.webp'):
                response['Content-Type'] = 'image/webp'
            elif file_path.endswith('.mp4'):
                response['Content-Type'] = 'video/mp4'
            elif file_path.endswith('.jpg') or file_path.endswith('.jpeg'):
                response['Content-Type'] = 'image/jpeg'
            elif file_path.endswith('.png'):
                response['Content-Type'] = 'image/png'
            else:
                # Try to detect MIME type
                try:
                    mime = magic.Magic(mime=True)
                    content_type = mime.from_file(file_path)
                    response['Content-Type'] = content_type
                except:
                    response['Content-Type'] = 'application/octet-stream'
            
            return response
        except (FileNotFoundError, PermissionError):
            return HttpResponse(status=404)
        except Exception:
            return HttpResponse(status=500)

    def _generate_response_direct(self, photo, path, fname, transcode_videos):
        """Generate response by serving files directly (no X-Accel-Redirect)"""
        if "thumbnail" in path:
            # Handle thumbnail files
            file_path = os.path.join(settings.MEDIA_ROOT, path, fname)
            
            # Try different extensions if the exact file doesn't exist
            if not os.path.exists(file_path):
                # Try with .webp extension
                if not fname.endswith('.webp'):
                    file_path_webp = os.path.join(settings.MEDIA_ROOT, path, fname + '.webp')
                    if os.path.exists(file_path_webp):
                        return self._serve_file_direct(file_path_webp, 'image/webp')
                
                # Try with .mp4 extension for video thumbnails
                if not fname.endswith('.mp4'):
                    file_path_mp4 = os.path.join(settings.MEDIA_ROOT, path, fname + '.mp4')
                    if os.path.exists(file_path_mp4):
                        return self._serve_file_direct(file_path_mp4, 'video/mp4')
            
            # Check if it's a legacy .jpg thumbnail
            filename = os.path.splitext(photo.thumbnail.square_thumbnail.path)[1] if hasattr(photo, 'thumbnail') else ''
            if "jpg" in filename and hasattr(photo, 'thumbnail'):
                # Handle non-migrated systems
                return self._serve_file_direct(photo.thumbnail.thumbnail_big.path, 'image/jpg')
            
            return self._serve_file_direct(file_path)

        if "faces" in path:
            file_path = os.path.join(settings.MEDIA_ROOT, path, fname)
            return self._serve_file_direct(file_path, 'image/jpg')

        if photo.video:
            # For video files, serve directly from the original location
            if transcode_videos:
                # Note: Video transcoding not implemented for no-proxy mode
                # Fall back to serving original file
                pass
            
            # Serve original video file
            return self._serve_file_direct(photo.main_file.path)
        
        # For other files (faces, avatars, etc.)
        file_path = os.path.join(settings.MEDIA_ROOT, path, fname)
        return self._serve_file_direct(file_path, 'image/jpg')

    def get(self, request, path, fname, format=None):
        # Handle ZIP files
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
                file_path = os.path.join(settings.MEDIA_ROOT, path, filename)
                return self._serve_file_direct(file_path, 'application/x-zip-compressed')
            except Exception:
                return HttpResponseForbidden()

        # Handle avatars
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
                file_path = os.path.join(settings.MEDIA_ROOT, path, fname)
                return self._serve_file_direct(file_path, 'image/png')
            except Exception:
                return HttpResponse(status=404)

        # Handle embedded media
        if path.lower() == "embedded_media":
            jwt = request.COOKIES.get("jwt")
            query = Q(public=True)
            if request.user.is_authenticated:
                query = Q(owner=request.user)
            if jwt is not None:
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
            
            file_path = os.path.join(settings.MEDIA_ROOT, path, fname + "_1.mp4")
            return self._serve_file_direct(file_path, 'video/mp4')

        # Handle regular media files (not photos)
        if path.lower() != "photos":
            jwt = request.COOKIES.get("jwt")
            image_hash = fname.split(".")[0].split("_")[0]
            try:
                photo = Photo.objects.get(image_hash=image_hash)
            except Photo.DoesNotExist:
                return HttpResponse(status=404)

            # Grant access if the requested photo is public
            if photo.public:
                return self._generate_response_direct(photo, path, fname, False)

            # Check JWT token
            if jwt is not None:
                try:
                    token = AccessToken(jwt)
                except TokenError:
                    return HttpResponseForbidden()
            else:
                return HttpResponseForbidden()

            # Grant access if user owns the photo or photo is shared with user
            user = User.objects.filter(id=token["user_id"]).only("id", "transcode_videos").first()
            if photo.owner == user or user in photo.shared_to.all():
                return self._generate_response_direct(photo, path, fname, user.transcode_videos)
            else:
                for album in photo.albumuser_set.only("shared_to"):
                    if user in album.shared_to.all():
                        return self._generate_response_direct(photo, path, fname, user.transcode_videos)
            return HttpResponse(status=404)

        # Handle photos (original files)
        else:
            jwt = request.COOKIES.get("jwt")
            image_hash = fname.split(".")[0].split("_")[0]
            try:
                photo = Photo.objects.get(image_hash=image_hash)
            except Photo.DoesNotExist:
                return HttpResponse(status=404)

            # Grant access if the requested photo is public
            if photo.public:
                return self._serve_file_direct(photo.main_file.path)

            # Check JWT token
            if jwt is not None:
                try:
                    token = AccessToken(jwt)
                except TokenError:
                    return HttpResponseForbidden()
            else:
                return HttpResponseForbidden()

            # Grant access if user owns the photo or photo is shared with user
            user = User.objects.filter(id=token["user_id"]).only("id").first()
            if photo.owner == user or user in photo.shared_to.all():
                return self._serve_file_direct(photo.main_file.path)
            else:
                for album in photo.albumuser_set.only("shared_to"):
                    if user in album.shared_to.all():
                        return self._serve_file_direct(photo.main_file.path)
            return HttpResponse(status=404)


# API Router
router = routers.DefaultRouter()
router.register(r"user", user.UserViewSet, basename="user")
router.register(r"manage/user", user.ManageUserViewSet, basename="manage_user")
router.register(r"delete/user", user.DeleteUserViewSet, basename="delete_user")

router.register(
    r"albums/auto/list", album_auto.AlbumAutoListViewSet, basename="album_auto_list"
)
router.register(
    r"albums/date/list", albums.AlbumDateListViewSet, basename="album_date_list"
)
router.register(
    r"albums/thing/list", albums.AlbumThingListViewSet, basename="album_thing_list"
)
router.register(
    r"albums/place/list", albums.AlbumPlaceListViewSet, basename="album_place_list"
)
router.register(
    r"albums/user/list", albums.AlbumUserListViewSet, basename="album_user_list"
)

router.register(
    r"albums/user/edit", views.AlbumUserEditViewSet, basename="edit_album_user"
)

router.register(
    r"albums/user/shared/tome",
    sharing.SharedToMeAlbumUserListViewSet,
    basename="share_to_me_album_user",
)
router.register(
    r"albums/user/shared/fromme",
    sharing.SharedFromMeAlbumUserListViewSet,
    basename="share_from_me_album_user",
)

router.register(r"albums/auto", album_auto.AlbumAutoViewSet, basename="album_auto")
router.register(
    r"albums/person", albums.AlbumPersonViewSet, basename="album_person"
)
router.register(r"albums/date", albums.AlbumDateViewSet, basename="album_date")
router.register(r"albums/thing", albums.AlbumThingViewSet, basename="album_thing")
router.register(r"albums/place", albums.AlbumPlaceViewSet, basename="album_place")
router.register(r"albums/user", albums.AlbumUserViewSet, basename="album_user")

router.register(r"persons", albums.PersonViewSet, basename="persons")

router.register(
    r"photos/shared/tome",
    sharing.SharedToMePhotoSuperSimpleListViewSet,
    basename="shared_to_me_photo",
)
router.register(
    r"photos/shared/fromme",
    sharing.SharedFromMePhotoSuperSimpleListViewSet,
    basename="shared_from_me_photo",
)

router.register(
    r"photos/notimestamp",
    photos.NoTimestampPhotoViewSet,
    basename="photos_no_timestamp",
)

router.register(r"photos/edit", photos.PhotoEditViewSet, basename="photo_edit")

router.register(
    r"photos/recentlyadded",
    photos.RecentlyAddedPhotoListViewSet,
    basename="recently_added_photo",
)
router.register(
    r"photos/searchlist", search.SearchListViewSet, basename="photo_search"
)

router.register(r"photos", photos.PhotoViewSet, basename="photos")

router.register(
    r"faces/incomplete",
    faces.FaceIncompleteListViewSet,
    basename="incomplete_faces",
)

router.register(r"faces", faces.FaceListView, basename="faces")

router.register(r"exists", upload.UploadPhotoExists, basename="photo_exists")
router.register(r"jobs", jobs.LongRunningJobViewSet, basename="jobs")
router.register(r"services", services.ServiceViewSet, basename="service")

# API URL patterns
api_urlpatterns = [
    re_path(r"^", include(router.urls)),
    re_path(r"^django-admin/", admin.site.urls),
    re_path(r"^sitesettings", views.SiteSettingsView.as_view()),
    re_path(r"^firsttimesetup", user.IsFirstTimeSetupView.as_view()),
    re_path(r"^dirtree", user.RootPathTreeView.as_view()),
    re_path(r"^labelfaces", faces.SetFacePersonLabel.as_view()),
    re_path(r"^deletefaces", faces.DeleteFaces.as_view()),
    re_path(r"^photosedit/delete", photos.DeletePhotos.as_view()),
    re_path(r"^photosedit/duplicate/delete", photos.DeleteDuplicatePhotos.as_view()),
    re_path(r"^photosedit/setdeleted", photos.SetPhotosDeleted.as_view()),
    re_path(r"^photosedit/favorite", photos.SetPhotosFavorite.as_view()),
    re_path(r"^photosedit/hide", photos.SetPhotosHidden.as_view()),
    re_path(r"^photosedit/makepublic", photos.SetPhotosPublic.as_view()),
    re_path(r"^photosedit/share", photos.SetPhotosShared.as_view()),
    re_path(r"^photosedit/generateim2txt", photos.GeneratePhotoCaption.as_view()),
    re_path(r"^photosedit/savecaption", photos.SavePhotoCaption.as_view()),
    re_path(r"^useralbum/share", views.SetUserAlbumShared.as_view()),
    re_path(r"^trainfaces", faces.TrainFaceView.as_view()),
    re_path(r"^clusterfaces", dataviz.ClusterFaceView.as_view()),
    re_path(r"^socialgraph", dataviz.SocialGraphView.as_view()),
    re_path(r"^scanphotos", views.ScanPhotosView.as_view()),
    re_path(r"^scanuploadedphotos", views.FullScanPhotosView.as_view()),
    re_path(r"^fullscanphotos", views.FullScanPhotosView.as_view()),
    re_path(r"^scanfaces", faces.ScanFacesView.as_view()),
    re_path(r"^deletemissingphotos", views.DeleteMissingPhotosView.as_view()),
    re_path(r"^autoalbumgen", album_auto.AutoAlbumGenerateView.as_view()),
    re_path(r"^autoalbumtitlegen", album_auto.RegenerateAutoAlbumTitles.as_view()),
    re_path(r"^searchtermexamples", views.SearchTermExamples.as_view()),
    re_path(r"^locationsunburst", dataviz.LocationSunburst.as_view()),
    re_path(r"^locationtimeline", dataviz.LocationTimeline.as_view()),
    re_path(r"^defaultrules", user.DefaultRulesView.as_view()),
    re_path(r"^predefinedrules", user.PredefinedRulesView.as_view()),
    re_path(r"^stats", dataviz.StatsView.as_view()),
    re_path(r"^storagestats", views.StorageStatsView.as_view()),
    re_path(r"^imagetag", views.ImageTagView.as_view()),
    re_path(r"^serverstats", dataviz.ServerStatsView.as_view()),
    re_path(r"^serverlogs", dataviz.ServerLogsView.as_view()),
    re_path(r"^locclust", dataviz.LocationClustersView.as_view()),
    re_path(r"^photomonthcounts", dataviz.PhotoMonthCountsView.as_view()),
    re_path(r"^wordcloud", dataviz.SearchTermWordCloudView.as_view()),
    re_path(r"^auth/token/obtain/$", CustomTokenObtainPairView.as_view()),
    re_path(r"^auth/token/refresh/$", CustomTokenRefreshView.as_view()),
    re_path(r"^auth/token/blacklist/", TokenBlacklistView.as_view()),
    re_path(
        r"^delete/zip/(?P<fname>.*)",
        views.DeleteZipView.as_view(),
        name="delete-zip",
    ),
    re_path(r"^rqavailable/$", jobs.QueueAvailabilityView.as_view()),
    re_path(r"^nextcloud/listdir", nextcloud_views.ListDir.as_view()),
    re_path(r"^nextcloud/scanphotos", nextcloud_views.ScanPhotosView.as_view()),
    re_path(r"^photos/download$", views.ZipListPhotosView_V2.as_view()),
    re_path(r"^timezones", timezone.TimeZoneView.as_view()),
    re_path(r"upload/complete/", upload.UploadPhotosChunkedComplete.as_view()),
    re_path(r"upload/", upload.UploadPhotosChunked.as_view()),
]

# Main URL patterns
urlpatterns = [
    # API routes (prefixed with /api/)
    re_path(r"^api/", include(api_urlpatterns)),
    # Media routes (direct access for frontend compatibility - no-proxy mode)
    re_path(
        r"^media/(?P<path>.*)/(?P<fname>.*)",
        NoProxyMediaAccessView.as_view(),
        name="media_direct",
    ),
]

# Add static files serving
urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)

# Serve frontend assets and manifest directly
if getattr(settings, 'SERVE_FRONTEND', False):
    from django.views.static import serve
    import os
    
    # Serve assets from frontend build
    frontend_build_path = os.path.join(os.path.dirname(settings.BASE_DIR), 'frontend_build')
    urlpatterns += [
        re_path(r'^assets/(?P<path>.*)$', serve, {'document_root': os.path.join(frontend_build_path, 'assets')}),
        re_path(r'^(?P<path>manifest\.json)$', serve, {'document_root': frontend_build_path}),
        re_path(r'^(?P<path>favicon\.ico)$', serve, {'document_root': frontend_build_path}),
        # Add patterns for logo files
        re_path(r'^(?P<path>logo-white\.png)$', serve, {'document_root': frontend_build_path}), 
        re_path(r'^(?P<path>logo\.png)$', serve, {'document_root': frontend_build_path}),
        # Add pattern for other common frontend assets
        re_path(r'^(?P<path>unknown_user\.jpg)$', serve, {'document_root': frontend_build_path}),
        re_path(r'^(?P<path>.*\.(?:png|jpg|jpeg|gif|ico|svg))$', serve, {'document_root': frontend_build_path}),
    ]

# Add development tools in debug mode
if settings.DEBUG:
    from drf_spectacular.views import (
        SpectacularAPIView,
        SpectacularRedocView,
        SpectacularSwaggerView,
    )

    urlpatterns += [re_path(r"^api/silk/", include("silk.urls", namespace="silk"))]
    urlpatterns += [
        re_path(r"^api/schema", SpectacularAPIView.as_view(), name="schema"),
        re_path(r"^api/swagger", SpectacularSwaggerView.as_view(), name="swagger-ui"),
        re_path(r"^api/redoc", SpectacularRedocView.as_view(), name="redoc"),
    ]

# Catch-all pattern for frontend (must be last)
if getattr(settings, 'SERVE_FRONTEND', False):
    urlpatterns += [
        re_path(r"^(?!api/)(?!static/)(?!assets/)(?!manifest\.json).*$", FrontendView.as_view(), name="frontend"),
    ] 