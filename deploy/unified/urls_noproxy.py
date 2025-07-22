"""librephotos URL Configuration for No-Proxy Setup

This configuration serves both the API and the frontend from Django
"""

import os
from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import HttpResponse
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
from nextcloud import views as nextcloud_views


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
        r"^media/(?P<path>.*)/(?P<fname>.*)",
        views.MediaAccessFullsizeOriginalView.as_view(),
        name="media",
    ),
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