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
from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from rest_framework import routers
from api import views

router = routers.DefaultRouter()

router.register(r'api/albums/auto', views.AlbumAutoViewSet)
router.register(r'api/albums/person', views.AlbumPersonViewSet)
router.register(r'api/albums/date', views.AlbumDateViewSet)
router.register(r'api/persons', views.PersonViewSet)
router.register(r'api/photos', views.PhotoViewSet)
router.register(r'api/faces/inferred',views.FaceInferredViewSet)
router.register(r'api/faces/labeled',views.FaceLabeledViewSet)
router.register(r'api/faces', views.FaceViewSet)

urlpatterns = [
    url(r'^', include(router.urls)),
    url(r'^admin/', admin.site.urls),
    url(r'^api/facetolabel', views.FaceToLabelView.as_view()),
]+static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
