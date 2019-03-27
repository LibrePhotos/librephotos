"""ownphotos URL Configuration

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/1.11/topics/http/urls/
Examples:
Function views
    1. Add an import:  from my_app import views
    2. Add a URL to urlpatterns:  url(r'^$', views.home, name='home')
Class-based views
    1. Add an import:  from other_app.views import Home
    2. Add a URL to urlpatterns:  url(r'^$', Home.as_view(), name='home')
Including another URLconf
    1. Import the include() function: from django.conf.urls import url, include
    2. Add a URL to urlpatterns:  url(r'^blog/', include('blog.urls'))
"""
from django.conf.urls import url, include
from django.urls import path
from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from rest_framework import routers
from rest_framework.permissions import IsAuthenticated, IsAdminUser, AllowAny
from api import views
from nextcloud import views as nextcloud_views

# from rest_framework_jwt.views import obtain_jwt_token
# from rest_framework_jwt.views import refresh_jwt_token
# from rest_framework_jwt.views import verify_jwt_token

from api.views import media_access

import ipdb

from rest_framework_simplejwt.serializers import TokenObtainPairSerializer, TokenRefreshSerializer
from rest_framework_simplejwt.views import TokenObtainPairView, TokenRefreshView


class TokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super(TokenObtainPairSerializer, cls).get_token(user)

        # Add custom claims
        # ipdb.set_trace()
        token['name'] = user.get_username()
        token['is_admin'] = user.is_superuser
        token['first_name'] = user.first_name
        token['last_name'] = user.last_name
        token['scan_directory'] = user.scan_directory
        token['nextcloud_server_address'] = user.nextcloud_server_address
        token['nextcloud_username'] = user.nextcloud_username
        # ...

        return token


class TokenObtainPairView(TokenObtainPairView):
    serializer_class = TokenObtainPairSerializer

    def post(self, request, *args, **kwargs):
        # ipdb.set_trace()
        response = super(TokenObtainPairView, self).post(
            request, *args, **kwargs)
        response.set_cookie('jwt', response.data['access'])
        response.set_cookie('test', 'obtain')
        response['Access-Control-Allow-Credentials'] = True
        return response


class TokenRefreshView(TokenRefreshView):
    serializer_class = TokenRefreshSerializer

    def post(self, request, *args, **kwargs):
        # ipdb.set_trace()
        response = super(TokenRefreshView, self).post(request, *args, **kwargs)
        response.set_cookie('jwt', response.data['access'])
        response.set_cookie('test', 'refresh')
        response['Access-Control-Allow-Credentials'] = True
        return response


router = routers.DefaultRouter()

router.register(r'api/user', views.UserViewSet, base_name='user')
router.register(r'api/manage/user', views.ManageUserViewSet)

router.register(
    r'api/albums/auto/list',
    views.AlbumAutoListViewSet,
    base_name='album_auto')
router.register(
    r'api/albums/date/list',
    views.AlbumDateListViewSet,
    base_name='album_date')
router.register(
    r'api/albums/date/photohash/list',
    views.AlbumDateListWithPhotoHashViewSet,
    base_name='album_date')
router.register(
    r'api/albums/person/list',
    views.AlbumPersonListViewSet,
    base_name='person')
router.register(
    r'api/albums/thing/list',
    views.AlbumThingListViewSet,
    base_name='album_thing')
router.register(
    r'api/albums/place/list',
    views.AlbumPlaceListViewSet,
    base_name='album_place')
router.register(
    r'api/albums/user/list',
    views.AlbumUserListViewSet,
    base_name='album_user')

router.register(
    r'api/albums/user/edit',
    views.AlbumUserEditViewSet,
    base_name='album_user')

router.register(
    r'api/albums/user/shared/tome',
    views.SharedToMeAlbumUserListViewSet,
    base_name='album_user')
router.register(
    r'api/albums/user/shared/fromme',
    views.SharedFromMeAlbumUserListViewSet,
    base_name='album_user')

router.register(
    r'api/albums/auto', views.AlbumAutoViewSet, base_name='album_auto')
router.register(
    r'api/albums/person', views.AlbumPersonViewSet, base_name='person')
router.register(r'api/albums/date', views.AlbumDateViewSet)
router.register(
    r'api/albums/thing', views.AlbumThingViewSet, base_name='album_thing')
router.register(
    r'api/albums/place', views.AlbumPlaceViewSet, base_name='album_place')
router.register(
    r'api/albums/user', views.AlbumUserViewSet, base_name='album_user')

router.register(r'api/persons', views.PersonViewSet, base_name='person')

router.register(
    r'api/photos/shared/tome',
    views.SharedToMePhotoSuperSimpleListViewSet,
    base_name='photo')
router.register(
    r'api/photos/shared/fromme',
    views.SharedFromMePhotoSuperSimpleListViewSet2,
    base_name='photo')

router.register(
    r'api/photos/notimestamp/list',
    views.NoTimestampPhotoHashListViewSet,
    base_name='photo')

router.register(r'api/photos/edit', views.PhotoEditViewSet, base_name='photo')

router.register(
    r'api/photos/recentlyadded',
    views.RecentlyAddedPhotoListViewSet,
    base_name='photo')
router.register(
    r'api/photos/simplelist', views.PhotoSimpleListViewSet, base_name='photo')
router.register(
    r'api/photos/list', views.PhotoSuperSimpleListViewSet, base_name='photo')
router.register(
    r'api/photos/favorites', views.FavoritePhotoListViewset, base_name='photo')
router.register(
    r'api/photos/hidden', views.HiddenPhotoListViewset, base_name='photo')
router.register(
    r'api/photos/searchlist',
    views.PhotoSuperSimpleSearchListViewSet,
    base_name='photo')

router.register(
    r'api/photos/public', views.PublicPhotoListViewset, base_name='photo')

router.register(r'api/photos', views.PhotoViewSet, base_name='photo')

router.register(
    r'api/faces/inferred/list',
    views.FaceInferredListViewSet,
    base_name='face')

router.register(
    r'api/faces/labeled/list', views.FaceLabeledListViewSet, base_name='face')

router.register(r'api/faces/list', views.FaceListViewSet, base_name='face')

router.register(
    r'api/faces/inferred', views.FaceInferredViewSet, base_name='face')
router.register(
    r'api/faces/labeled', views.FaceLabeledViewSet, base_name='face')
router.register(r'api/faces', views.FaceViewSet)

router.register(r'api/jobs', views.LongRunningJobViewSet)

urlpatterns = [
    url(r'^', include(router.urls)),
    url(r'^admin/', admin.site.urls),
    url(r'^api/sitesettings', views.SiteSettingsView.as_view()),
    url(r'^api/dirtree', views.RootPathTreeView.as_view()),
    url(r'^api/labelfaces', views.SetFacePersonLabel.as_view()),
    url(r'^api/deletefaces', views.DeleteFaces.as_view()),
    url(r'^api/photosedit/favorite', views.SetPhotosFavorite.as_view()),
    url(r'^api/photosedit/hide', views.SetPhotosHidden.as_view()),
    url(r'^api/photosedit/makepublic', views.SetPhotosPublic.as_view()),
    url(r'^api/photosedit/share', views.SetPhotosShared.as_view()),
    url(r'^api/photosedit/generateim2txt',
        views.GeneratePhotoCaption.as_view()),
    url(r'^api/useralbum/share', views.SetUserAlbumShared.as_view()),
    url(r'^api/facetolabel', views.FaceToLabelView.as_view()),
    url(r'^api/trainfaces', views.TrainFaceView.as_view()),
    url(r'^api/clusterfaces', views.ClusterFaceView.as_view()),
    url(r'^api/socialgraph', views.SocialGraphView.as_view()),
    url(r'^api/egograph', views.EgoGraphView.as_view()),
    url(r'^api/scanphotos', views.ScanPhotosView.as_view()),
    url(r'^api/autoalbumgen', views.AutoAlbumGenerateView.as_view()),
    url(r'^api/autoalbumtitlegen', views.RegenerateAutoAlbumTitles.as_view()),
    url(r'^api/searchtermexamples', views.SearchTermExamples.as_view()),
    url(r'^api/locationsunburst', views.LocationSunburst.as_view()),
    url(r'^api/locationtimeline', views.LocationTimeline.as_view()),
    url(r'^api/stats', views.StatsView.as_view()),
    url(r'^api/locclust', views.LocationClustersView.as_view()),
    url(r'^api/photocountrycounts', views.PhotoCountryCountsView.as_view()),
    url(r'^api/photomonthcounts', views.PhotoMonthCountsView.as_view()),
    url(r'^api/wordcloud', views.SearchTermWordCloudView.as_view()),

    url(r'^api/similar', views.SearchSimilarPhotosView.as_view()),

    url(r'^api/watcher/photo', views.IsPhotosBeingAddedView.as_view()),
    url(r'^api/watcher/autoalbum', views.IsAutoAlbumsBeingProcessed.as_view()),
    url(r'^api/auth/token/obtain/$', TokenObtainPairView.as_view()),
    url(r'^api/auth/token/refresh/$', TokenRefreshView.as_view()),
    #     url(r'^media/(?P<path>.*)', media_access, name='media'),

    url(r'^media/(?P<path>.*)/(?P<fname>.*)',
        views.MediaAccessFullsizeOriginalView.as_view(),
        name='media'),

    url(r'^api/rqavailable/$', views.QueueAvailabilityView.as_view()),
    url(r'^api/rqjobstat/$', views.RQJobStatView.as_view()),
    url(r'^api/rqjoblist/$', views.ListAllRQJobsView.as_view()),

    url(r'^api/nextcloud/listdir', nextcloud_views.ListDir.as_view()),
    url(r'^api/nextcloud/scanphotos',
        nextcloud_views.ScanPhotosView.as_view()),

    #     url(r'^api/token-auth/', obtain_jwt_token),
    #     url(r'^api/token-refresh/', refresh_jwt_token),
    #     url(r'^api/token-verify/', verify_jwt_token),
]
# ] + static(
#     settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

urlpatterns += [url(r'^api/django-rq/', include('django_rq.urls'))]
# urlpatterns += [url(r'^silk/', include('silk.urls', namespace='silk'))]
