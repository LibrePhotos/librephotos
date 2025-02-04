from constance import config as site_config
from rest_framework import permissions

from api.models import User


class IsAdminOrSelf(permissions.BasePermission):
    def has_object_permission(self, request, view, obj):
        if request.method in permissions.SAFE_METHODS:
            return True

        return request.user and request.user.is_staff or obj == request.user


class IsAdminOrFirstTimeSetupOrRegistrationAllowed(permissions.BasePermission):
    def has_permission(self, request, view):
        if request.method in permissions.SAFE_METHODS:
            return True

        is_admin = request.user and request.user.is_staff
        is_first_time_setup = not User.objects.filter(is_superuser=True).exists()
        is_registration_allowed = bool(site_config.ALLOW_REGISTRATION)

        return is_admin or is_first_time_setup or is_registration_allowed


class IsOwnerOrReadOnly(permissions.BasePermission):
    """Custom permission to only allow owners of an object to edit it."""

    def has_object_permission(self, request, view, obj):
        # Read permissions are allowed to any request,
        # so we'll always allow GET, HEAD or OPTIONS requests.
        if request.method in permissions.SAFE_METHODS:
            return True

        # Write permissions are only allowed to the owner of the snippet.
        return obj.owner == request.user


class IsUserOrReadOnly(permissions.BasePermission):
    """Custom permission to only allow owners of an object to edit it."""

    def has_object_permission(self, request, view, obj):
        # Read permissions are allowed to any request,
        # so we'll always allow GET, HEAD or OPTIONS requests.
        if request.method in permissions.SAFE_METHODS:
            return True

        # Write permissions are only allowed to the owner of the snippet.
        return obj == request.user


class IsPhotoOrAlbumSharedTo(permissions.BasePermission):
    """Custom permission to only allow owners of an object to edit it."""

    def has_object_permission(self, request, view, obj):
        if obj.public:
            return True

        if obj.owner == request.user or request.user in obj.shared_to.all():
            return True

        for album in obj.albumuser_set.only("shared_to"):
            if request.user in album.shared_to.all():
                return True

        return False


class IsRegistrationAllowed(permissions.BasePermission):
    """Custom permission to only allow if registration is allowed globally."""

    def has_permission(self, request, view):
        return bool(site_config.ALLOW_REGISTRATION)
