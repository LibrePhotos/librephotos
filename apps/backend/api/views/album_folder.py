import logging
import os
from typing import TypedDict

from django.conf import settings
from django.db.models import Case, Count, F, IntegerField, Value, When, Window
from django.db.models.functions import RowNumber
from drf_spectacular.utils import extend_schema
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import (
    APIException,
    PermissionDenied,
    ValidationError,
)
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response

from api.drf.pagination import PAGE_PARAMETERS, PaginatedViewMixin
from api.drf.params import parse_query
from api.drf.request_user import request_user
from api.models.photo import Photo
from api.models.user import User
from api.photos.paths import folder_path_q, is_valid_path
from api.serializers.folders import FolderPathQuery, FolderSubfoldersPageSerializer

logger = logging.getLogger(__name__)


def _user_scan_directory(user: User) -> str | None:
    if not hasattr(user, "scan_directory"):
        return None
    return user.scan_directory or None


def _default_path(request: Request, is_admin: bool) -> str:
    """The folder a listing without ?path starts at; 403 if there is none."""
    if is_admin:
        return settings.DATA_ROOT
    scan_directory = _user_scan_directory(request_user(request))
    if not scan_directory:
        raise PermissionDenied("User scan directory not configured")
    return scan_directory


def _validate_path(base_path: str) -> None:
    if not os.path.exists(base_path):
        raise ValidationError("Path does not exist")
    if not os.path.isdir(base_path):
        raise ValidationError("Path is not a directory")


def _check_access(request: Request, base_path: str, is_admin: bool) -> None:
    if is_admin:
        if not is_valid_path(base_path, settings.DATA_ROOT):
            raise PermissionDenied("Access denied")
        return

    scan_directory = _user_scan_directory(request_user(request))
    if not scan_directory:
        raise PermissionDenied("User scan directory not configured")
    if not os.path.exists(scan_directory):
        raise PermissionDenied("Scan directory does not exist")
    # A plain startswith() let /data/alice reach the sibling /data/alice2, and
    # /data/alice/../bob reach anything; is_valid_path compares whole,
    # normalised path components.
    if not is_valid_path(base_path, scan_directory):
        raise PermissionDenied(
            "Access denied - can only access folders within your scan directory"
        )


def _parent_path(request: Request, base_path: str, is_admin: bool) -> str | None:
    root = settings.DATA_ROOT if is_admin else request_user(request).scan_directory
    return os.path.dirname(base_path) if base_path != root else None


def _scan_folder_entries(base_path: str) -> list[tuple[str, str, float]]:
    entries: list[tuple[str, str, float]] = []
    for item in os.scandir(base_path):
        if item.is_dir() and not item.name.startswith("."):
            entries.append((item.name, item.path, os.path.getmtime(item.path)))
    entries.sort(key=lambda x: x[0].lower())
    return entries


def _photo_counts(user: User, entries: list[tuple[str, str, float]]) -> list[int]:
    aggregates = {
        f"count_{idx}": Count(
            "pk",
            filter=folder_path_q("files__path", folder_path),
            distinct=True,
        )
        for idx, (_, folder_path, _) in enumerate(entries)
    }
    # The photos the Library shows (hidden, trashed and still unprocessed ones
    # excluded): a tile counting the others opened a smaller, or an empty,
    # timeline. A folder left with none is not listed.
    counts = Photo.visible.owned_by(user).aggregate(**aggregates)
    return [counts.get(f"count_{idx}", 0) or 0 for idx in range(len(entries))]


class FolderCover(TypedDict):
    image_hash: str
    video: bool


class FolderEntry(TypedDict):
    name: str
    path: str
    photo_count: int
    modified: float
    cover_photo: FolderCover | None


def _folder_covers(
    user: User, entries: list[tuple[str, str, float]]
) -> dict[int, FolderCover]:
    """The newest photo in and below each folder (#2233), by entry index.

    One query for the page: every photo row is tagged with the folder its file
    lies in and numbered newest first per folder, and the first of each is
    kept. The photos are the ones ``_photo_counts`` counts, the caller's own
    visible ones, so a cover is never hidden, trashed or someone else's.
    ``folder_path_q`` keeps a folder out of a sibling sharing its name's start.
    """
    folder = Case(
        *(
            When(folder_path_q("files__path", folder_path), then=Value(idx))
            for idx, (_, folder_path, _) in enumerate(entries)
        ),
        output_field=IntegerField(),
    )
    newest_first = Window(
        RowNumber(),
        partition_by=F("folder"),
        order_by=[
            F("exif_timestamp").desc(nulls_last=True),
            F("added_on").desc(),
            F("pk").asc(),
        ],
    )
    rows = (
        Photo.visible.owned_by(user)
        .annotate(folder=folder)
        .filter(folder__isnull=False)
        .annotate(rank=newest_first)
        .filter(rank=1)
        .values_list("folder", "image_hash", "video")
    )
    return {
        idx: FolderCover(image_hash=image_hash, video=video)
        for idx, image_hash, video in rows
    }


def _folder_listing(
    user: User, entries: list[tuple[str, str, float]]
) -> list[FolderEntry]:
    counts = _photo_counts(user, entries)
    covers = _folder_covers(user, entries)
    return [
        FolderEntry(
            name=name,
            path=folder_path,
            photo_count=photo_count,
            modified=mtime,
            cover_photo=covers.get(idx),
        )
        for idx, ((name, folder_path, mtime), photo_count) in enumerate(
            zip(entries, counts)
        )
        if photo_count > 0
    ]


class FolderNavigationViewSet(PaginatedViewMixin, viewsets.ViewSet):
    """
    ViewSet for folder navigation functionality.
    Returns paginated subfolders for a given path (100 directory entries per
    page; folders without photos are dropped after paging, so a page can hold
    fewer, or none, while ``next`` says more follow).
    Only queries photo counts for folders in the current page for optimal performance.

    Query Parameters:
    - path: The directory path to list subfolders for
    - page, page_size: as every paginated list (api/drf/pagination.py)

    Security:
    - Admins (is_staff=True) can access all folders within DATA_ROOT
    - Regular users can only access folders within their scan_directory
    - All paths are validated to prevent directory traversal attacks
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        parameters=[FolderPathQuery, *PAGE_PARAMETERS],
        responses=FolderSubfoldersPageSerializer,
    )
    @action(detail=False, methods=["get"])
    def subfolders(self, request: Request) -> Response:
        """Get subfolders for a given path with pagination."""
        params = parse_query(request, FolderPathQuery)
        user = request_user(request)
        is_admin = user.is_staff

        # No scan directory is the normal state of a user who only sees shared
        # albums: an empty listing, not a denial. An explicit path is still
        # refused below.
        if not is_admin and not _user_scan_directory(user) and "path" not in params:
            self.paginate_queryset([])
            return self._folder_response(None, None, [])

        # The default is worked out even when a path is given: a user without a
        # scan directory is refused here for an explicit path too.
        default_path = _default_path(request, is_admin)
        base_path = params.get("path", default_path)

        # Access first: validating first answered "does not exist" or "is not
        # a directory" for paths the caller may not see, which made this an
        # existence oracle for the whole filesystem.
        _check_access(request, base_path, is_admin)
        _validate_path(base_path)

        try:
            folder_entries = _scan_folder_entries(base_path)
        except Exception as e:
            logger.error("Error scanning directory %s: %s", base_path, e)
            raise APIException("Error scanning directory") from e

        parent_path = _parent_path(request, base_path, is_admin)
        page_entries = self.paginate_queryset(folder_entries)
        subfolders = _folder_listing(user, page_entries) if page_entries else []
        return self._folder_response(base_path, parent_path, subfolders)

    def _folder_response(
        self,
        base_path: str | None,
        parent_path: str | None,
        subfolders: list[FolderEntry],
    ) -> Response:
        """The page ``paginate_queryset`` cut, with the folder's own fields.

        ``subfolders`` and ``pagination`` repeat ``results`` and the page
        fields in the shape this endpoint had before #2327, for web bundles up
        to 1.3; remove them after the next release.
        """
        response = self.get_paginated_response(subfolders)
        page = self.paginator.current_page()
        response.data.update(
            {
                "current_path": base_path,
                "parent_path": parent_path,
                "subfolders": subfolders,
                "pagination": {
                    "page": page.number,
                    "page_size": page.paginator.per_page,
                    "total_folders": page.paginator.count,
                    "total_pages": page.paginator.num_pages,
                    "has_next": page.has_next(),
                    "has_previous": page.has_previous(),
                },
            }
        )
        return response
