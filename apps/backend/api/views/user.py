import logging
from typing import Any

from django.conf import settings
from django.db.models import QuerySet
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiResponse, extend_schema
from rest_framework import mixins, serializers, viewsets
from rest_framework.exceptions import PermissionDenied, ValidationError
from rest_framework.permissions import (
    AllowAny,
    BasePermission,
    IsAdminUser,
    IsAuthenticated,
)
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.throttling import BaseThrottle
from rest_framework.views import APIView

from api.accounts.permissions import (
    IsAdminOrFirstTimeSetupOrRegistrationAllowed,
    IsAdminOrSelf,
    IsSuperUser,
)
from api.accounts.throttling import AuthRateThrottle
from api.drf.pagination import DefaultPagination
from api.drf.params import parse_query
from api.metadata.datetime_rules import DEFAULT_RULES_JSON, PREDEFINED_RULES_JSON
from api.models import User
from api.photos.paths import is_valid_path
from api.serializers.folders import DirTreeSerializer, FolderPathQuery
from api.serializers.user import (
    DeleteUserSerializer,
    FirstTimeSetupSerializer,
    ManageUserSerializer,
    PublicUserSerializer,
    SignupUserSerializer,
    UserSerializer,
    with_user_relations,
)
from api.serving.directory_tree import path_to_dict
from api.stacks.burst_rules import (
    DEFAULT_RULES_JSON as BURST_DEFAULT_RULES_JSON,
)
from api.stacks.burst_rules import (
    PREDEFINED_RULES_JSON as BURST_PREDEFINED_RULES_JSON,
)
from api.views.mixins import PartialUpdateModelMixin

logger = logging.getLogger(__name__)

# The rule views send the list encoded as a JSON string (a string, not an
# array): clients decode it a second time.
RULES_RESPONSE = OpenApiResponse(
    OpenApiTypes.STR, description="A JSON array of rules, encoded as a string"
)


class DefaultRulesView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses=RULES_RESPONSE)
    def get(self, request: Request, format: str | None = None) -> Response:
        res = DEFAULT_RULES_JSON
        return Response(res)


class PredefinedRulesView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(responses=RULES_RESPONSE)
    def get(self, request: Request, format: str | None = None) -> Response:
        res = PREDEFINED_RULES_JSON
        return Response(res)


class DefaultBurstRulesView(APIView):
    """Get default burst detection rules."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses=RULES_RESPONSE)
    def get(self, request: Request, format: str | None = None) -> Response:
        res = BURST_DEFAULT_RULES_JSON
        return Response(res)


class PredefinedBurstRulesView(APIView):
    """Get all predefined burst detection rules (default + optional)."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses=RULES_RESPONSE)
    def get(self, request: Request, format: str | None = None) -> Response:
        res = BURST_PREDEFINED_RULES_JSON
        return Response(res)


class RootPathTreeView(APIView):
    permission_classes = (IsAdminUser,)

    @extend_schema(parameters=[FolderPathQuery], responses=DirTreeSerializer(many=True))
    def get(self, request: Request, format: str | None = None) -> Response:
        path = parse_query(request, FolderPathQuery).get("path")
        base_path = settings.DATA_ROOT

        # Default to root directory if no path is provided
        if not path:
            path = base_path

        # Validate the requested path
        if not is_valid_path(path, base_path):
            raise PermissionDenied(
                "Access denied. Path is outside the allowed directory."
            )

        # Anything else that fails is a 500 from the handler, logged there,
        # without the exception text (it used to echo it, paths and all).
        return Response([path_to_dict(path)])


class IsFirstTimeSetupView(APIView):
    permission_classes = (AllowAny,)

    @extend_schema(responses=FirstTimeSetupSerializer)
    def get(self, request: Request) -> Response:
        return Response(
            {"isFirstTimeSetup": not User.objects.filter(is_superuser=True).exists()}
        )


# Users are deleted through /api/delete/user/ only, which refuses to delete a
# superuser (the last one would put the instance back into first-time setup).
# Neither viewset below has a destroy, so they cannot delete anyone.


# List and open users, sign up (create), and edit one's own settings (PATCH).
class UserViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    mixins.CreateModelMixin,
    PartialUpdateModelMixin[User],
    viewsets.GenericViewSet,
):
    pagination_class = DefaultPagination

    def get_queryset(self) -> QuerySet[User]:
        queryset = with_user_relations(
            User.objects.exclude(is_active=False)
            # Every field the serializers read is loaded with the row: an
            # .only() list fell behind the serializer and each missing field
            # cost one more query per user. The secrets are never read.
            .defer("password", "nextcloud_app_password")
        ).order_by("id")
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

    def perform_create(self, serializer: serializers.BaseSerializer[User]) -> None:
        user = serializer.save()
        # The response renders counts the serializers read from annotations.
        serializer.instance = with_user_relations(User.objects.filter(pk=user.pk)).get()

    def get_throttles(self) -> list[BaseThrottle]:
        # Sign-up and first-time setup are open to anonymous callers; an admin
        # adding users in the user editor is not held to the sign-in rate.
        if self.action == "create" and not self.request.user.is_staff:
            return [AuthRateThrottle()]
        return super().get_throttles()

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
    # Staff and superuser both, as before; a staff user who is not a superuser
    # now gets a 403 instead of the 401 that signed the web client out.
    permission_classes = (IsAdminUser, IsSuperUser)

    def destroy(self, request: Request, *args: Any, **kwargs: Any) -> Response:
        instance = self.get_object()

        # Nor the ``deleted`` placeholder: its rows would be handed to itself,
        # and the delete failed with a 500.
        if instance.is_superuser or instance.username == "deleted":
            raise ValidationError("This user cannot be deleted.")

        # api.accounts.deletion turns off the user's public links and makes room
        # for their albums and tags in ``deleted``, in the delete's transaction.
        return super().destroy(request, *args, **kwargs)


# PATCH only: the admin user editor (scan directory, quotas, roles). Users are
# listed and opened through /api/user/, which gives staff the full serializer.
class ManageUserViewSet(PartialUpdateModelMixin[User], viewsets.GenericViewSet):
    queryset = with_user_relations(User.objects.all()).order_by("id")
    serializer_class = ManageUserSerializer
    permission_classes = (IsAdminUser,)
