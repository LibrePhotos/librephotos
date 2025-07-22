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
            with open(os.path.join(settings.BASE_DIR, 'frontend_build', 'index.html')) as f:
                return HttpResponse(f.read(), content_type='text/html')
        except FileNotFoundError:
            return HttpResponse(
                'Frontend build not found. Please build the frontend first.',
                status=500
            )


# API Router
router = routers.DefaultRouter()
router.register(r"albums/auto", album_auto.AlbumAutoListViewSet)
router.register(r"albums/date", album_auto.AlbumDateListViewSet)
router.register(r"albums/thing", album_auto.AlbumThingListViewSet)
router.register(r"albums/place", album_auto.AlbumPlaceListViewSet)
router.register(r"albums/user", albums.AlbumUserViewSet)
router.register(r"persons", faces.PersonViewSet)
router.register(r"faces", faces.FaceViewSet, basename="face")
router.register(r"faces/incomplete", faces.FaceIncompleteViewSet)
router.register(r"photos", photos.PhotoViewSet)
router.register(r"photos/edit", photos.PhotoEditViewSet)
router.register(r"photos/notimestamp", photos.NoTimestampPhotoViewSet)
router.register(r"albums/date/photohash", photos.AlbumDatePhotosViewSet)
router.register(r"user", user.UserViewSet)
router.register(r"manage/user", user.ManageUserViewSet)
router.register(r"upload", upload.UploadPhotosViewSet)
router.register(r"jobs", jobs.LongRunningJobViewSet)
router.register(r"search", search.SearchViewSet, basename="search")

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
        re_path(r"^.*$", FrontendView.as_view(), name="frontend"),
    ] 