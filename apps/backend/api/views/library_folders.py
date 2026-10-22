"""The folders of a user's library (#123).

Every user reads their own (``GET /api/library-folders/``). Adding and
removing a further folder needs the server's folder tree, which only admins
see, so those are admin routes under ``/api/manage/user/<id>/``, like the
scan directory itself.
"""

from django.db import transaction
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.drf.params import parse_body
from api.drf.request_user import request_user
from api.models import LibraryFolder, User
from api.photos.library_folders import add_library_folder, library_folder_entries
from api.serializers.library_folders import (
    AddLibraryFolderRequest,
    LibraryFoldersSerializer,
)


def _listing(user: User) -> Response:
    return Response({"folders": library_folder_entries(user)})


def _managed_user(user_id: int) -> User:
    """The active user an admin acts for; 404 for an unknown or deactivated one."""
    owner = User.objects.filter(pk=user_id, is_active=True).first()
    if owner is None:
        raise NotFound("No such user.")
    return owner


class OwnLibraryFoldersView(APIView):
    """The folders of the requester's own library, the scan directory first."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(responses=LibraryFoldersSerializer)
    def get(self, request: Request, format: str | None = None) -> Response:
        return _listing(request_user(request))


class ManageLibraryFoldersView(APIView):
    """A user's library folders, for the user edit dialog: list and add.

    POST adds a folder: an existing folder inside the data root that overlaps
    no folder of another user's library (#2034) nor of this one. 400 names
    the ``path`` field otherwise. The next scan reads it. Admins only; 404
    for an unknown or deactivated user.
    """

    permission_classes = (IsAdminUser,)

    @extend_schema(responses=LibraryFoldersSerializer)
    def get(
        self, request: Request, user_id: int, format: str | None = None
    ) -> Response:
        return _listing(_managed_user(user_id))

    @extend_schema(
        request=AddLibraryFolderRequest,
        responses={201: LibraryFoldersSerializer},
    )
    def post(
        self, request: Request, user_id: int, format: str | None = None
    ) -> Response:
        body = parse_body(request, AddLibraryFolderRequest)
        owner = _managed_user(user_id)
        with transaction.atomic():
            add_library_folder(owner, body["path"])
        return Response(
            {"folders": library_folder_entries(owner)}, status=status.HTTP_201_CREATED
        )


class ManageLibraryFolderView(APIView):
    """Remove a further folder from a user's library.

    Its photos stay the user's, outside the library now; the user edit dialog
    offers to move them to the user's trash
    (``POST /api/manage/user/<id>/trash-photos-outside-library/``). Files on
    disk are never touched. The scan directory is not a row here and cannot
    be removed. Admins only; 404 for another user's folder.
    """

    permission_classes = (IsAdminUser,)

    @extend_schema(responses=LibraryFoldersSerializer)
    def delete(
        self, request: Request, user_id: int, folder_id: int, format: str | None = None
    ) -> Response:
        owner = _managed_user(user_id)
        folder = LibraryFolder.objects.owned_by(owner).filter(pk=folder_id).first()
        if folder is None:
            raise NotFound("No such library folder.")
        folder.delete()
        return _listing(owner)
