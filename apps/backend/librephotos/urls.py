"""librephotos URL Configuration

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/1.11/topics/http/urls/

Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  re_path(r'^$', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  re_path(r'^$', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.conf.urls import url, include
    2. Add a URL to urlpatterns:  re_path(r'^blog/', include('blog.urls'))

"""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, re_path
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


router = routers.DefaultRouter()

router.register(r"api/user", user.UserViewSet, basename="user")
router.register(r"api/manage/user", user.ManageUserViewSet, basename="manage_user")
router.register(r"api/delete/user", user.DeleteUserViewSet, basename="delete_user")

router.register(
    r"api/albums/auto/list", album_auto.AlbumAutoListViewSet, basename="album_auto_list"
)
router.register(
    r"api/albums/date/list", albums.AlbumDateListViewSet, basename="album_date_list"
)
router.register(
    r"api/albums/thing/list", albums.AlbumThingListViewSet, basename="album_thing_list"
)
router.register(
    r"api/albums/place/list", albums.AlbumPlaceListViewSet, basename="album_place_list"
)
router.register(
    r"api/albums/user/list", albums.AlbumUserListViewSet, basename="album_user_list"
)

router.register(
    r"api/albums/user/edit", views.AlbumUserEditViewSet, basename="edit_album_user"
)

router.register(
    r"api/albums/user/shared/tome",
    sharing.SharedToMeAlbumUserListViewSet,
    basename="share_to_me_album_user",
)
router.register(
    r"api/albums/user/shared/fromme",
    sharing.SharedFromMeAlbumUserListViewSet,
    basename="share_from_me_album_user",
)

router.register(r"api/albums/auto", album_auto.AlbumAutoViewSet, basename="album_auto")
router.register(
    r"api/albums/person", albums.AlbumPersonViewSet, basename="album_person"
)
router.register(r"api/albums/date", albums.AlbumDateViewSet, basename="album_date")
router.register(r"api/albums/thing", albums.AlbumThingViewSet, basename="album_thing")
router.register(r"api/albums/place", albums.AlbumPlaceViewSet, basename="album_place")
router.register(r"api/albums/user", albums.AlbumUserViewSet, basename="album_user")

router.register(r"api/persons", albums.PersonViewSet, basename="persons")

router.register(
    r"api/photos/shared/tome",
    sharing.SharedToMePhotoSuperSimpleListViewSet,
    basename="shared_to_me_photo",
)
router.register(
    r"api/photos/shared/fromme",
    sharing.SharedFromMePhotoSuperSimpleListViewSet,
    basename="shared_from_me_photo",
)

router.register(
    r"api/photos/notimestamp",
    photos.NoTimestampPhotoViewSet,
    basename="photos_no_timestamp",
)

router.register(r"api/photos/edit", photos.PhotoEditViewSet, basename="photo_edit")

router.register(
    r"api/photos/recentlyadded",
    photos.RecentlyAddedPhotoListViewSet,
    basename="recently_added_photo",
)
router.register(
    r"api/photos/searchlist", search.SearchListViewSet, basename="photo_search"
)

router.register(r"api/photos", photos.PhotoViewSet, basename="photos")

router.register(
    r"api/faces/incomplete",
    faces.FaceIncompleteListViewSet,
    basename="incomplete_faces",
)

router.register(r"api/faces", faces.FaceListView, basename="faces")

router.register(r"api/exists", upload.UploadPhotoExists, basename="photo_exists")
router.register(r"api/jobs", jobs.LongRunningJobViewSet, basename="jobs")
router.register(r"api/services", services.ServiceViewSet, basename="service")

urlpatterns = [
    re_path(r"^", include(router.urls)),
    re_path(r"^api/django-admin/", admin.site.urls),
    re_path(r"^api/sitesettings", views.SiteSettingsView.as_view()),
    re_path(r"^api/firsttimesetup", user.IsFirstTimeSetupView.as_view()),
    re_path(r"^api/dirtree", user.RootPathTreeView.as_view()),
    re_path(r"^api/labelfaces", faces.SetFacePersonLabel.as_view()),
    re_path(r"^api/deletefaces", faces.DeleteFaces.as_view()),
    re_path(r"^api/photosedit/delete", photos.DeletePhotos.as_view()),
    re_path(
        r"^api/photosedit/duplicate/delete", photos.DeleteDuplicatePhotos.as_view()
    ),
    re_path(r"^api/photosedit/setdeleted", photos.SetPhotosDeleted.as_view()),
    re_path(r"^api/photosedit/favorite", photos.SetPhotosFavorite.as_view()),
    re_path(r"^api/photosedit/hide", photos.SetPhotosHidden.as_view()),
    re_path(r"^api/photosedit/makepublic", photos.SetPhotosPublic.as_view()),
    re_path(r"^api/photosedit/share", photos.SetPhotosShared.as_view()),
    re_path(r"^api/photosedit/generateim2txt", photos.GeneratePhotoCaption.as_view()),
    re_path(r"^api/photosedit/savecaption", photos.SavePhotoCaption.as_view()),
    re_path(r"^api/useralbum/share", views.SetUserAlbumShared.as_view()),
    re_path(r"^api/trainfaces", faces.TrainFaceView.as_view()),
    re_path(r"^api/clusterfaces", dataviz.ClusterFaceView.as_view()),
    re_path(r"^api/socialgraph", dataviz.SocialGraphView.as_view()),
    re_path(r"^api/scanphotos", views.ScanPhotosView.as_view()),
    re_path(r"^api/scanuploadedphotos", views.FullScanPhotosView.as_view()),
    re_path(r"^api/fullscanphotos", views.FullScanPhotosView.as_view()),
    re_path(r"^api/scanfaces", faces.ScanFacesView.as_view()),
    re_path(r"^api/deletemissingphotos", views.DeleteMissingPhotosView.as_view()),
    re_path(r"^api/autoalbumgen", album_auto.AutoAlbumGenerateView.as_view()),
    re_path(r"^api/autoalbumtitlegen", album_auto.RegenerateAutoAlbumTitles.as_view()),
    re_path(r"^api/searchtermexamples", views.SearchTermExamples.as_view()),
    re_path(r"^api/locationsunburst", dataviz.LocationSunburst.as_view()),
    re_path(r"^api/locationtimeline", dataviz.LocationTimeline.as_view()),
    re_path(r"^api/defaultrules", user.DefaultRulesView.as_view()),
    re_path(r"^api/predefinedrules", user.PredefinedRulesView.as_view()),
    re_path(r"^api/stats", dataviz.StatsView.as_view()),
    re_path(r"^api/storagestats", views.StorageStatsView.as_view()),
    re_path(r"^api/imagetag", views.ImageTagView.as_view()),
    re_path(r"^api/serverstats", dataviz.ServerStatsView.as_view()),
    re_path(r"^api/serverlogs", dataviz.ServerLogsView.as_view()),
    re_path(r"^api/locclust", dataviz.LocationClustersView.as_view()),
    re_path(r"^api/photomonthcounts", dataviz.PhotoMonthCountsView.as_view()),
    re_path(r"^api/wordcloud", dataviz.SearchTermWordCloudView.as_view()),
    re_path(r"^api/auth/token/obtain/$", CustomTokenObtainPairView.as_view()),
    re_path(r"^api/auth/token/refresh/$", CustomTokenRefreshView.as_view()),
    re_path(r"^api/auth/token/blacklist/", TokenBlacklistView.as_view()),
    re_path(
        r"^media/(?P<path>.*)/(?P<fname>.*)",
        views.MediaAccessFullsizeOriginalView.as_view(),
        name="media",
    ),
    re_path(
        r"^api/delete/zip/(?P<fname>.*)",
        views.DeleteZipView.as_view(),
        name="delete-zip",
    ),
    re_path(r"^api/rqavailable/$", jobs.QueueAvailabilityView.as_view()),
    re_path(r"^api/nextcloud/listdir", nextcloud_views.ListDir.as_view()),
    re_path(r"^api/nextcloud/scanphotos", nextcloud_views.ScanPhotosView.as_view()),
    re_path(r"^api/photos/download$", views.ZipListPhotosView_V2.as_view()),
    re_path(r"^api/timezones", timezone.TimeZoneView.as_view()),
    re_path(r"api/upload/complete/", upload.UploadPhotosChunkedComplete.as_view()),
    re_path(r"api/upload/", upload.UploadPhotosChunked.as_view()),
]
urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)

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
