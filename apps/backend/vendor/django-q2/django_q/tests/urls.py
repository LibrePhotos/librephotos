from django.contrib import admin
from django.urls import re_path

urlpatterns = [
    re_path(r"^admin/", admin.site.urls),
]
