"""The folders of a user's library (#123).

Every user reads their own (``GET /api/library-folders/``) and may leave
folders inside them out (#791). Adding and
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

from api.drf.params import parse_body, parse_query
from api.drf.request_user import request_user
from api.jobs.start import start_job
from api.models import LibraryFolder, LongRunningJob, User
from api.photos.excluded_folders import library_subfolders, set_excluded_folders
from api.photos.library_folders import add_library_folder, library_folder_entries
from api.photos.outside_library import (
    photos_outside_library,
    trash_photos_outside_library_job,
)
from api.photos.paths import excluded_folders
from api.serializers.job import JobStartedResponseSerializer
from api.serializers.library_folders import (
    AddLibraryFolderRequest,
    ExcludedFoldersRequest,
    ExcludedFoldersSavedSerializer,
    LibraryFoldersSerializer,
    LibrarySubfoldersQuery,
    LibrarySubfoldersSerializer,
)


def _folders(user: User) -> dict[str, object]:
    return {
        "folders": library_folder_entries(user),
        "excluded_folders": excluded_folders(user),
    }


def _listing(user: User) -> Response:
    return Response(_folders(user))


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
        return Response(_folders(owner), status=status.HTTP_201_CREATED)


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


class OwnExcludedFoldersView(APIView):
    """Leave folders out of the requester's own library (#791).

    PUT replaces the list. Each folder must lie inside one of the library
    folders and not hold the upload folder; 400 names ``excluded_folders``
    otherwise. Scans skip them from now on; the photos already imported from
    them count as outside the library (``outside_count``) and stay until the
    user moves them to the trash (``POST /api/library-folders/trash-outside/``).
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=ExcludedFoldersRequest, responses=ExcludedFoldersSavedSerializer
    )
    def put(self, request: Request, format: str | None = None) -> Response:
        body = parse_body(request, ExcludedFoldersRequest)
        user = request_user(request)
        set_excluded_folders(user, body["excluded_folders"])
        saved = _folders(user)
        saved["outside_count"] = photos_outside_library(user).count()
        return Response(saved)


class OwnLibrarySubfoldersView(APIView):
    """The folders inside a folder of the requester's library, for leaving some out.

    404 for a path outside the library or inside a folder left out.
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[LibrarySubfoldersQuery], responses=LibrarySubfoldersSerializer
    )
    def get(self, request: Request, format: str | None = None) -> Response:
        query = parse_query(request, LibrarySubfoldersQuery)
        return Response(library_subfolders(request_user(request), query["path"]))


class TrashOwnPhotosOutsideLibraryView(APIView):
    """Move the requester's photos outside their library to their trash, as a job.

    After leaving folders out of the library (#791). Only the requester's own
    photos; files are not touched and the photos can be restored from the
    trash. 409 while one runs.
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses=JobStartedResponseSerializer)
    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        return start_job(
            user,
            LongRunningJob.JOB_TRASH_PHOTOS_OUTSIDE_LIBRARY,
            trash_photos_outside_library_job,
            user,
            description="moving the photos outside the library to the trash",
        )
