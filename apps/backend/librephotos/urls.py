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
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView

from api.views import (
    album_auto,
    albums,
    dataviz,
    faces,
    jobs,
    photos,
    search,
    sharing,
    timezone,
    upload,
    user,
    views,
)
from nextcloud import views as nextcloud_views


class TokenObtainPairSerializer(TokenObtainPairSerializer):
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
        # ...

        return token


class TokenObtainPairView(TokenObtainPairView):
    serializer_class = TokenObtainPairSerializer

    def post(self, request, *args, **kwargs):
        response = super(TokenObtainPairView, self).post(request, *args, **kwargs)
        response.set_cookie("jwt", response.data["access"])
        response.set_cookie("test", "obtain")
        response["Access-Control-Allow-Credentials"] = True
        return response


class TokenRefreshView(TokenRefreshView):
    serializer_class = TokenRefreshSerializer

    def post(self, request, *args, **kwargs):
        response = super(TokenRefreshView, self).post(request, *args, **kwargs)
        response.set_cookie("jwt", response.data["access"])
        response.set_cookie("test", "refresh")
        response["Access-Control-Allow-Credentials"] = True
        return response


router = routers.DefaultRouter()

router.register(r"api/user", user.UserViewSet, basename="user")
router.register(r"api/manage/user", user.ManageUserViewSet)
router.register(r"api/delete/user", user.DeleteUserViewSet)

router.register(
    r"api/albums/auto/list", album_auto.AlbumAutoListViewSet, basename="album_auto"
)
router.register(
    r"api/albums/date/list", albums.AlbumDateListViewSet, basename="album_date"
)
router.register(
    r"api/albums/thing/list", albums.AlbumThingListViewSet, basename="album_thing"
)
router.register(
    r"api/albums/place/list", albums.AlbumPlaceListViewSet, basename="album_place"
)
router.register(
    r"api/albums/user/list", albums.AlbumUserListViewSet, basename="album_user"
)

router.register(
    r"api/albums/user/edit", views.AlbumUserEditViewSet, basename="album_user"
)

router.register(
    r"api/albums/user/shared/tome",
    sharing.SharedToMeAlbumUserListViewSet,
    basename="album_user",
)
router.register(
    r"api/albums/user/shared/fromme",
    sharing.SharedFromMeAlbumUserListViewSet,
    basename="album_user",
)

router.register(r"api/albums/auto", album_auto.AlbumAutoViewSet, basename="album_auto")
router.register(r"api/albums/person", albums.AlbumPersonViewSet, basename="person")
router.register(r"api/albums/date", albums.AlbumDateViewSet, basename="album_date")
router.register(r"api/albums/thing", albums.AlbumThingViewSet, basename="album_thing")
router.register(r"api/albums/place", albums.AlbumPlaceViewSet, basename="album_place")
router.register(r"api/albums/user", albums.AlbumUserViewSet, basename="album_user")

router.register(r"api/persons", albums.PersonViewSet, basename="person")

router.register(
    r"api/photos/shared/tome",
    sharing.SharedToMePhotoSuperSimpleListViewSet,
    basename="photo",
)
router.register(
    r"api/photos/shared/fromme",
    sharing.SharedFromMePhotoSuperSimpleListViewSet,
    basename="photo",
)

router.register(
    r"api/photos/notimestamp",
    photos.NoTimestampPhotoViewSet,
    basename="photo",
)

router.register(r"api/photos/edit", photos.PhotoEditViewSet, basename="photo")

router.register(
    r"api/photos/recentlyadded", photos.RecentlyAddedPhotoListViewSet, basename="photo"
)
router.register(r"api/photos/searchlist", search.SearchListViewSet, basename="photo")

router.register(r"api/photos", photos.PhotoViewSet, basename="photo")

router.register(
    r"api/faces/incomplete", faces.FaceIncompleteListViewSet, basename="face"
)

router.register(r"api/faces", faces.FaceListView, basename="face")

router.register(r"api/exists", upload.UploadPhotoExists, basename="exists")

router.register(r"api/jobs", jobs.LongRunningJobViewSet)
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
    re_path(r"^api/serverstats", dataviz.ServerStatsView.as_view()),
    re_path(r"^api/locclust", dataviz.LocationClustersView.as_view()),
    re_path(r"^api/photomonthcounts", dataviz.PhotoMonthCountsView.as_view()),
    re_path(r"^api/wordcloud", dataviz.SearchTermWordCloudView.as_view()),
    re_path(r"^api/auth/token/obtain/$", TokenObtainPairView.as_view()),
    re_path(r"^api/auth/token/refresh/$", TokenRefreshView.as_view()),
    re_path(
        r"^media/(?P<path>.*)/(?P<fname>.*)",
        views.MediaAccessFullsizeOriginalView.as_view(),
        name="media",
    ),
    re_path(r"^api/rqavailable/$", jobs.QueueAvailabilityView.as_view()),
    re_path(r"^api/nextcloud/listdir", nextcloud_views.ListDir.as_view()),
    re_path(r"^api/nextcloud/scanphotos", nextcloud_views.ScanPhotosView.as_view()),
    re_path(r"^api/photos/download", views.ZipListPhotosView.as_view()),
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
