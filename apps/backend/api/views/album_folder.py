import logging
import os

from django.conf import settings
from django.db.models import Count
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

from api.models.photo import Photo
from api.models.user import User
from api.request_user import request_user
from api.util import folder_path_q, is_valid_path

logger = logging.getLogger(__name__)

PAGE_SIZE = 100


def _requested_page(request: Request) -> int:
    try:
        page = int(request.query_params.get("page", 1))
    except (ValueError, TypeError):
        return 1
    return page if page >= 1 else 1


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


def _folder_listing(
    user: User, entries: list[tuple[str, str, float]]
) -> list[dict[str, str | int | float]]:
    counts = _photo_counts(user, entries)
    return [
        {
            "name": name,
            "path": folder_path,
            "photo_count": photo_count,
            "modified": mtime,
        }
        for (name, folder_path, mtime), photo_count in zip(entries, counts)
        if photo_count > 0
    ]


def _folder_response(
    base_path: str | None,
    parent_path: str | None,
    subfolders: list[dict[str, str | int | float]],
    page: int,
    total_folders: int,
) -> Response:
    total_pages = (total_folders + PAGE_SIZE - 1) // PAGE_SIZE
    return Response(
        {
            "current_path": base_path,
            "parent_path": parent_path,
            "subfolders": subfolders,
            "pagination": {
                "page": page,
                "page_size": PAGE_SIZE,
                "total_folders": total_folders,
                "total_pages": total_pages,
                "has_next": page < total_pages,
                "has_previous": page > 1,
            },
        }
    )


class FolderNavigationViewSet(viewsets.ViewSet):
    """
    ViewSet for folder navigation functionality.
    Returns paginated subfolders for a given path (max 100 per page).
    Only queries photo counts for folders in the current page for optimal performance.

    Query Parameters:
    - path: The directory path to list subfolders for
    - page: Page number for pagination (default: 1)

    Security:
    - Admins (is_staff=True) can access all folders within DATA_ROOT
    - Regular users can only access folders within their scan_directory
    - All paths are validated to prevent directory traversal attacks
    """

    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=["get"])
    def subfolders(self, request: Request) -> Response:
        """Get subfolders for a given path with pagination."""
        page = _requested_page(request)
        user = request_user(request)
        is_admin = user.is_staff

        # No scan directory is the normal state of a user who only sees shared
        # albums: an empty listing, not a denial. An explicit path is still
        # refused below.
        if (
            not is_admin
            and not _user_scan_directory(user)
            and "path" not in request.query_params
        ):
            return _folder_response(None, None, [], page, 0)

        base_path = request.query_params.get("path", _default_path(request, is_admin))

        # Access first: validating first answered "does not exist" or "is not
        # a directory" for paths the caller may not see, which made this an
        # existence oracle for the whole filesystem.
        _check_access(request, base_path, is_admin)
        _validate_path(base_path)

        try:
            folder_entries = _scan_folder_entries(base_path)
            parent_path = _parent_path(request, base_path, is_admin)

            start_idx = (page - 1) * PAGE_SIZE
            paginated_entries = folder_entries[start_idx : start_idx + PAGE_SIZE]
            if not paginated_entries:
                return _folder_response(
                    base_path, parent_path, [], page, len(folder_entries)
                )

            return _folder_response(
                base_path,
                parent_path,
                _folder_listing(user, paginated_entries),
                page,
                len(folder_entries),
            )

        except Exception as e:
            logger.error(f"Error scanning directory {base_path}: {e}")
            raise APIException("Error scanning directory") from e
