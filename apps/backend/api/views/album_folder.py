import os
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.conf import settings
from django.db.models import Count, Q

from api.util import logger
from api.models.photo import Photo

PAGE_SIZE = 100


def _requested_page(request):
    try:
        page = int(request.query_params.get("page", 1))
    except (ValueError, TypeError):
        return 1
    return page if page >= 1 else 1


def _user_scan_directory(user):
    if not hasattr(user, "scan_directory"):
        return None
    return user.scan_directory or None


def _default_path(request, is_admin):
    """Return (path, error_response); exactly one of them is set."""
    if is_admin:
        return settings.DATA_ROOT, None
    scan_directory = _user_scan_directory(request.user)
    if not scan_directory:
        return None, Response(
            {"error": "User scan directory not configured"}, status=403
        )
    return scan_directory, None


def _validate_path(base_path):
    if not os.path.exists(base_path):
        return Response({"error": "Path does not exist"}, status=400)
    if not os.path.isdir(base_path):
        return Response({"error": "Path is not a directory"}, status=400)
    return None


def _check_access(request, base_path, is_admin):
    if is_admin:
        if not base_path.startswith(settings.DATA_ROOT):
            return Response({"error": "Access denied"}, status=403)
        return None

    scan_directory = _user_scan_directory(request.user)
    if not scan_directory:
        return Response({"error": "User scan directory not configured"}, status=403)
    if not os.path.exists(scan_directory):
        return Response({"error": "Scan directory does not exist"}, status=403)
    if not base_path.startswith(scan_directory):
        return Response(
            {
                "error": "Access denied - can only access folders within your scan directory"
            },
            status=403,
        )
    return None


def _parent_path(request, base_path, is_admin):
    root = settings.DATA_ROOT if is_admin else request.user.scan_directory
    return os.path.dirname(base_path) if base_path != root else None


def _scan_folder_entries(base_path):
    entries = []
    for item in os.scandir(base_path):
        if item.is_dir() and not item.name.startswith("."):
            entries.append((item.name, item.path, os.path.getmtime(item.path)))
    entries.sort(key=lambda x: x[0].lower())
    return entries


def _photo_counts(user, entries):
    aggregates = {
        f"count_{idx}": Count(
            "pk", filter=Q(files__path__startswith=folder_path), distinct=True
        )
        for idx, (_, folder_path, _) in enumerate(entries)
    }
    counts = Photo.objects.filter(owner=user).aggregate(**aggregates)
    return [counts.get(f"count_{idx}", 0) or 0 for idx in range(len(entries))]


def _folder_listing(user, entries):
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


def _folder_response(base_path, parent_path, subfolders, page, total_folders):
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
    def subfolders(self, request):
        """Get subfolders for a given path with pagination."""
        page = _requested_page(request)
        is_admin = request.user.is_staff if request.user else False

        default_path, error = _default_path(request, is_admin)
        if error:
            return error

        base_path = request.query_params.get("path", default_path)

        error = _validate_path(base_path) or _check_access(request, base_path, is_admin)
        if error:
            return error

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
                _folder_listing(request.user, paginated_entries),
                page,
                len(folder_entries),
            )

        except Exception as e:
            logger.error(f"Error scanning directory {base_path}: {e}")
            return Response({"error": "Error scanning directory"}, status=500)
