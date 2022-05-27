from django.core.cache import cache
from rest_framework import permissions, viewsets
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_extensions.cache.decorators import cache_response

import ownphotos.settings
from api.api_util import path_to_dict
from api.date_time_extractor import DEFAULT_RULES_JSON, PREDEFINED_RULES_JSON
from api.models import User
from api.permissions import IsRegistrationAllowed, IsUserOrReadOnly
from api.serializers.user import ManageUserSerializer, UserSerializer
from api.util import logger
from api.views.caching import (
    CACHE_TTL,
    CustomListKeyConstructor,
    CustomObjectKeyConstructor,
)


class DefaultRulesView(APIView):
    def get(self, request, format=None):
        res = DEFAULT_RULES_JSON
        return Response(res)


class PredefinedRulesView(APIView):
    def get(self, request, format=None):
        res = PREDEFINED_RULES_JSON
        return Response(res)


class RootPathTreeView(APIView):
    permission_classes = (IsAdminUser,)

    def get(self, request, format=None):
        try:
            path = self.request.query_params.get("path")
            if path:
                res = [path_to_dict(path)]
            else:
                res = [path_to_dict(ownphotos.settings.DATA_ROOT)]
            return Response(res)
        except Exception as e:
            logger.exception(str(e))
            return Response({"message": str(e)})


class FirstTimeSetupPermission(permissions.BasePermission):
    message = "Check if the first time setup is done"

    def has_permission(self, request, view):
        return not User.objects.filter(is_superuser=True).exists()


class UserViewSet(viewsets.ModelViewSet):

    serializer_class = UserSerializer

    permission_classes = (IsUserOrReadOnly,)

    def get_queryset(self):
        queryset = User.objects.only(
            "id",
            "username",
            "email",
            "scan_directory",
            "transcode_videos",
            "confidence",
            "semantic_search_topk",
            "first_name",
            "last_name",
            "date_joined",
            "avatar",
            "nextcloud_server_address",
            "nextcloud_username",
            "nextcloud_scan_directory",
            "favorite_min_rating",
            "image_scale",
            "save_metadata_to_disk",
            "datetime_rules",
            "default_timezone",
        ).order_by("-last_login")
        return queryset

    def get_permissions(self):
        if self.action == "create":
            self.permission_classes = [IsRegistrationAllowed | FirstTimeSetupPermission]
            cache.clear()
        elif self.action == "list":
            self.permission_classes = (AllowAny,)
        elif self.request.method == "GET" or self.request.method == "POST":
            self.permission_classes = (AllowAny,)
        else:
            self.permission_classes = (IsUserOrReadOnly,)
        return super(UserViewSet, self).get_permissions()

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(UserViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(UserViewSet, self).list(*args, **kwargs)


class ManageUserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all().order_by("-last_login")
    serializer_class = ManageUserSerializer
    permission_classes = (IsAdminUser,)

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(ManageUserViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(ManageUserViewSet, self).list(*args, **kwargs)
