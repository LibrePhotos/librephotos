import logging
from typing import Any

from django.conf import settings
from django.db.models import QuerySet
from rest_framework import mixins, serializers, status, viewsets
from rest_framework.permissions import AllowAny, BasePermission, IsAdminUser
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.api_util import path_to_dict
from api.burst_detection_rules import (
    DEFAULT_RULES_JSON as BURST_DEFAULT_RULES_JSON,
)
from api.burst_detection_rules import (
    PREDEFINED_RULES_JSON as BURST_PREDEFINED_RULES_JSON,
)
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
from api.util import is_valid_path
from api.views.mixins import PartialUpdateModelMixin

logger = logging.getLogger(__name__)


class DefaultRulesView(APIView):
    def get(self, request: Request, format: str | None = None) -> Response:
        res = DEFAULT_RULES_JSON
        return Response(res)


class PredefinedRulesView(APIView):
    def get(self, request: Request, format: str | None = None) -> Response:
        res = PREDEFINED_RULES_JSON
        return Response(res)


class DefaultBurstRulesView(APIView):
    """Get default burst detection rules."""

    def get(self, request: Request, format: str | None = None) -> Response:
        res = BURST_DEFAULT_RULES_JSON
        return Response(res)


class PredefinedBurstRulesView(APIView):
    """Get all predefined burst detection rules (default + optional)."""

    def get(self, request: Request, format: str | None = None) -> Response:
        res = BURST_PREDEFINED_RULES_JSON
        return Response(res)


class RootPathTreeView(APIView):
    permission_classes = (IsAdminUser,)

    def get(self, request: Request, format: str | None = None) -> Response:
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

    def get(self, request: Request) -> Response:
        return Response(
            {"isFirstTimeSetup": not User.objects.filter(is_superuser=True).exists()}
        )


# Users are deleted through /api/delete/user/ only, which refuses to delete a
# superuser (the last one would put the instance back into first-time setup).
# Neither viewset below has a destroy, so they cannot delete anyone.


# To-Do: This executes multiple querys per users
# List and open users, sign up (create), and edit one's own settings (PATCH).
class UserViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    PartialUpdateModelMixin[User],
    viewsets.GenericViewSet,
):
    def get_queryset(self) -> QuerySet[User]:
        queryset = (
            User.objects.exclude(is_active=False)
            # Every field the serializers read is loaded with the row: an
            # .only() list fell behind the serializer and each missing field
            # cost one more query per user. The secrets are never read.
            .defer("password", "nextcloud_app_password")
            .order_by("id")
        )
        if not self.request.user.is_authenticated:
            return queryset.exclude(public_sharing=False)
        return queryset

    def get_serializer_class(self) -> type[serializers.BaseSerializer[User]]:
        if self.action == "create":
            if self.request.user.is_authenticated and self.request.user.is_superuser:
                return UserSerializer
            return SignupUserSerializer

        user = self.request.user
        # list / retrieve are the enumeration surface. The full UserSerializer
        # exposes sensitive fields (email, scan_directory, Nextcloud server/
        # username, is_superuser, ...), so restrict it to admins and to a user
        # viewing their OWN record; every other reader (anonymous or another
        # authenticated user) gets the public-safe serializer. A user's own
        # settings come from /api/manage/user and the JWT token claims.
        # See issue #1861.
        if self.action in ("list", "retrieve"):
            if user.is_authenticated and (user.is_staff or user.is_superuser):
                return UserSerializer
            if (
                self.action == "retrieve"
                and user.is_authenticated
                and str(self.kwargs.get("pk")) == str(user.id)
            ):
                return UserSerializer
            return PublicUserSerializer

        # partial_update is already restricted to self-or-admin by
        # get_permissions (IsAdminOrSelf) and needs the full serializer.
        return UserSerializer

    def get_permissions(self) -> list[BasePermission]:
        permission_classes: list[type[BasePermission]] = [IsAdminUser]
        if self.action == "create":
            permission_classes = [IsAdminOrFirstTimeSetupOrRegistrationAllowed]
        elif self.action in ["list", "retrieve"]:
            permission_classes = [AllowAny]
        elif self.action == "partial_update":
            permission_classes = [IsAdminOrSelf]
        return [p() for p in permission_classes]


class DeleteUserViewSet(mixins.DestroyModelMixin, viewsets.GenericViewSet):
    # Delete only. This used to be a full ModelViewSet over a serializer of
    # every User column, so an admin could read password hashes here and PUT a
    # scan_directory or upload_directory that ManageUserSerializer would have
    # refused (outside DATA_ROOT, or overlapping another user's library).
    # Listing and editing users goes through /api/manage/user/.
    queryset = User.objects.all().order_by("id")
    serializer_class = DeleteUserSerializer
    permission_classes = (IsAdminUser,)

    def destroy(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        if not request.user.is_superuser:
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        instance = self.get_object()

        # Nor the ``deleted`` placeholder: its rows would be handed to itself,
        # and the delete failed with a 500.
        if instance.is_superuser or instance.username == "deleted":
            return Response(status=status.HTTP_400_BAD_REQUEST)

        # api.user_deletion turns off the user's public links and makes room
        # for their albums and tags in ``deleted``, in the delete's transaction.
        return super().destroy(request, *args, **kwargs)


# PATCH only: the admin user editor (scan directory, quotas, roles). Users are
# listed and opened through /api/user/, which gives staff the full serializer.
class ManageUserViewSet(PartialUpdateModelMixin[User], viewsets.GenericViewSet):
    queryset = User.objects.all().order_by("id")
    serializer_class = ManageUserSerializer
    permission_classes = (IsAdminUser,)
