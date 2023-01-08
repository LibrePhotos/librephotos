from rest_framework import permissions, status, viewsets
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

import ownphotos.settings
from api.api_util import path_to_dict
from api.date_time_extractor import DEFAULT_RULES_JSON, PREDEFINED_RULES_JSON
from api.models import User
from api.permissions import IsRegistrationAllowed, IsUserOrReadOnly
from api.serializers.user import (
    DeleteUserSerializer,
    ManageUserSerializer,
    UserSerializer,
)
from api.util import logger


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

class IsFirstTimeSetupView(APIView):
    permission_classes = (AllowAny,)

    def get(self, request, format=None):
        try:
            return Response({"isFirstTimeSetup": not User.objects.filter(is_superuser=True).exists()})
        except Exception as e:
            logger.exception(str(e))
            return Response({"message": str(e)})

class FirstTimeSetupPermission(permissions.BasePermission):
    message = "Check if the first time setup is done"

    def has_permission(self, request, view):
        return not User.objects.filter(is_superuser=True).exists()


class UserViewSet(viewsets.ModelViewSet):

    serializer_class = UserSerializer

    permission_classes = (IsAdminUser,)

    def get_queryset(self):
        queryset = (
            User.objects.exclude(is_active=False)
            .only(
                "id",
                "username",
                "email",
                "scan_directory",
                "transcode_videos",
                "confidence",
                "confidence_person",
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
                "is_superuser",
            )
            .order_by("id")
        )
        return queryset

    def get_permissions(self):
        if self.action == "create":
            self.permission_classes = [
                IsRegistrationAllowed | FirstTimeSetupPermission | IsAdminUser
            ]
        if self.request.method == "POST":
            self.permission_classes = (AllowAny,)
        return super(UserViewSet, self).get_permissions()

    def create(self, request, *args, **kwargs):
        if User.objects.filter(is_superuser=True).exists() and not request.user.is_superuser:
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        return super(UserViewSet, self).create(request, *args, **kwargs)

    def retrieve(self, *args, **kwargs):
        return super(UserViewSet, self).retrieve(*args, **kwargs)

    def list(self, *args, **kwargs):
        return super(UserViewSet, self).list(*args, **kwargs)


class DeleteUserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all().order_by("id")
    serializer_class = DeleteUserSerializer
    permission_classes = (IsAdminUser,)

    def destroy(self, request, *args, **kwargs):
        if not request.user.is_superuser:
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        instance = self.get_object()

        if instance.is_superuser:
            return Response(status=status.HTTP_400_BAD_REQUEST)

        return super().destroy(request, *args, **kwargs)


class ManageUserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all().order_by("id")
    serializer_class = ManageUserSerializer
    permission_classes = (IsAdminUser,)

    def retrieve(self, *args, **kwargs):
        return super(ManageUserViewSet, self).retrieve(*args, **kwargs)

    def list(self, *args, **kwargs):
        return super(ManageUserViewSet, self).list(*args, **kwargs)
