from constance import config as site_config
from rest_framework import permissions
from rest_framework.request import Request
from rest_framework.views import APIView

from api.faces.person_shares import photos_seen_through_people
from api.models import AlbumUser, AlbumUserPhoto, Photo, User


class IsAdminOrSelf(permissions.BasePermission):
    """A user edits their own account; staff edit the others.

    A superuser's account only by a superuser: staff who are not one could
    set its password or email and sign in as it (GHSA-57r4-v566-3rcw).
    """

    def has_object_permission(self, request: Request, view: APIView, obj: User) -> bool:
        if request.method in permissions.SAFE_METHODS:
            return True
        if obj == request.user:
            return True
        return bool(request.user.is_staff and outranks_or_equals(request.user, obj))


def outranks_or_equals(actor: User, target: User) -> bool:
    """Whether ``actor`` may act on ``target``'s account as an admin: a
    superuser on anyone, anyone else not on a superuser."""
    return bool(actor.is_superuser or not target.is_superuser)


class MayManageUser(permissions.BasePermission):
    """The ``outranks_or_equals`` rule as an object permission, for the admin
    user editor; list it after ``IsAdminUser``."""

    def has_object_permission(self, request: Request, view: APIView, obj: User) -> bool:
        actor = request.user
        return isinstance(actor, User) and outranks_or_equals(actor, obj)


class IsSuperUser(permissions.BasePermission):
    """Only superusers. List it after IsAdminUser where staff is required too."""

    def has_permission(self, request: Request, view: APIView) -> bool:
        return bool(request.user.is_superuser)


class IsAdminOrFirstTimeSetupOrRegistrationAllowed(permissions.BasePermission):
    def has_permission(self, request: Request, view: APIView) -> bool:
        if request.method in permissions.SAFE_METHODS:
            return True

        is_admin = bool(request.user) and request.user.is_staff
        is_first_time_setup = not User.objects.filter(is_superuser=True).exists()
        is_registration_allowed = bool(site_config.ALLOW_REGISTRATION)

        return bool(is_admin or is_first_time_setup or is_registration_allowed)


class IsOwnerOrReadOnly(permissions.BasePermission):
    """Custom permission to only allow owners of an object to edit it."""

    def has_object_permission(
        self, request: Request, view: APIView, obj: Photo
    ) -> bool:
        # Read permissions are allowed to any request,
        # so we'll always allow GET, HEAD or OPTIONS requests.
        if request.method in permissions.SAFE_METHODS:
            return True

        # Write permissions are only allowed to the owner of the snippet.
        return obj.owner == request.user


class IsPhotoOrAlbumSharedTo(permissions.BasePermission):
    """Custom permission to only allow owners of an object to edit it."""

    def has_object_permission(
        self, request: Request, view: APIView, obj: Photo
    ) -> bool:
        # Owner, a direct share, a public photo or a shared library, and for
        # anyone but the owner never once hidden, trashed or removed: hiding
        # clears neither ``shared_to`` nor ``public`` (GHSA-57r4-v566-3rcw).
        if Photo.objects.visible_to(request.user).filter(pk=obj.pk).exists():
            return True

        # Through an album only along a vouched link (the album owner's photo,
        # or a current contributor's, #464) of an album the requester owns
        # or is a member of.
        if (
            AlbumUserPhoto.objects.vouched()
            .filter(photo=obj)
            .filter(albumuser__in=AlbumUser.objects.owned_or_shared_to(request.user))
            .exists()
        ):
            return True

        # An approved photo of a person shared with the requester (#668).
        return photos_seen_through_people(request.user).filter(pk=obj.pk).exists()


class IsNextcloudEnabled(permissions.BasePermission):
    """Custom permission to only allow if the Nextcloud integration is enabled."""

    def has_permission(self, request: Request, view: APIView) -> bool:
        return bool(site_config.NEXTCLOUD_ENABLED)
