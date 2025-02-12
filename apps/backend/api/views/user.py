from django.conf import settings
from rest_framework import status, viewsets
from rest_framework.permissions import AllowAny, IsAdminUser
from rest_framework.response import Response
from rest_framework.views import APIView

from api.api_util import path_to_dict
from api.date_time_extractor import DEFAULT_RULES_JSON, PREDEFINED_RULES_JSON
from api.models import User
from api.permissions import IsAdminOrFirstTimeSetupOrRegistrationAllowed, IsAdminOrSelf
from api.serializers.user import (
    DeleteUserSerializer,
    ManageUserSerializer,
    PublicUserSerializer,
    SignupUserSerializer,
    UserSerializer,
)
from api.util import is_valid_path, logger


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
            base_path = settings.DATA_ROOT

            # Default to root directory if no path is provided
            if not path:
                path = base_path

            # Validate the requested path
            if not is_valid_path(path, base_path):
                return Response(
                    {
                        "message": "Access denied. Path is outside the allowed directory."
                    },
                    status=403,
                )

            res = [path_to_dict(path)]
            return Response(res)
        except Exception as e:
            logger.exception(str(e))
            return Response({"message": str(e)}, status=500)


class IsFirstTimeSetupView(APIView):
    permission_classes = (AllowAny,)

    def get(self, request):
        return Response(
            {"isFirstTimeSetup": not User.objects.filter(is_superuser=True).exists()}
        )


# To-Do: This executes multiple querys per users
class UserViewSet(viewsets.ModelViewSet):
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
                "public_sharing",
            )
            .order_by("id")
        )
        if not self.request.user.is_authenticated:
            return queryset.exclude(public_sharing=False)
        return queryset

    def get_serializer_class(self):
        if not self.request.user.is_authenticated and self.action == "create":
            return SignupUserSerializer
        if not self.request.user.is_authenticated:
            return PublicUserSerializer
        return UserSerializer

    def get_permissions(self):
        permission_classes = [IsAdminUser]
        if self.action == "create":
            permission_classes = [IsAdminOrFirstTimeSetupOrRegistrationAllowed]
        elif self.action in ["list", "retrieve"]:
            permission_classes = [AllowAny]
        elif self.action in ["update", "partial_update"]:
            permission_classes = [IsAdminOrSelf]
        return [p() for p in permission_classes]


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
