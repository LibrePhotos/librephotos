import os
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.conf import settings
from django.db.models import Count, Q

from api.util import logger
from api.models.photo import Photo


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
        # Get pagination parameters
        try:
            page = int(request.query_params.get("page", 1))
            if page < 1:
                page = 1
        except (ValueError, TypeError):
            page = 1

        page_size = 100  # Fixed page size of 100 folders

        # Determine default path based on user permissions
        is_admin = request.user.is_staff if request.user else False

        if is_admin:
            default_path = settings.DATA_ROOT
        else:
            # For regular users, default to their scan directory
            if hasattr(request.user, "scan_directory") and request.user.scan_directory:
                default_path = request.user.scan_directory
            else:
                return Response(
                    {"error": "User scan directory not configured"}, status=403
                )

        base_path = request.query_params.get("path", default_path)

        # Validate path is within allowed directories
        if not os.path.exists(base_path):
            return Response({"error": "Path does not exist"}, status=400)

        if not os.path.isdir(base_path):
            return Response({"error": "Path is not a directory"}, status=400)

        # Security check - determine allowed paths based on user permissions
        is_admin = request.user.is_staff if request.user else False

        if is_admin:
            # Admins can access all folders within DATA_ROOT
            if not base_path.startswith(settings.DATA_ROOT):
                return Response({"error": "Access denied"}, status=403)
        else:
            # Regular users can only access folders within their scan directory
            if (
                not hasattr(request.user, "scan_directory")
                or not request.user.scan_directory
            ):
                return Response(
                    {"error": "User scan directory not configured"}, status=403
                )

            # Ensure scan directory exists
            scan_directory = request.user.scan_directory
            if not os.path.exists(scan_directory):
                return Response({"error": "Scan directory does not exist"}, status=403)

            # Ensure requested path is within user's scan directory
            if not base_path.startswith(scan_directory):
                return Response(
                    {
                        "error": "Access denied - can only access folders within your scan directory"
                    },
                    status=403,
                )

        try:
            # Gather immediate subfolders and their mtimes
            folder_entries = []
            for item in os.scandir(base_path):
                if item.is_dir() and not item.name.startswith("."):
                    folder_entries.append(
                        (item.name, item.path, os.path.getmtime(item.path))
                    )

            # Early return if there are no subfolders
            if not folder_entries:
                if is_admin:
                    parent_path = (
                        os.path.dirname(base_path)
                        if base_path != settings.DATA_ROOT
                        else None
                    )
                else:
                    parent_path = (
                        os.path.dirname(base_path)
                        if base_path != request.user.scan_directory
                        else None
                    )
                return Response(
                    {
                        "current_path": base_path,
                        "parent_path": parent_path,
                        "subfolders": [],
                        "pagination": {
                            "page": page,
                            "page_size": page_size,
                            "total_folders": 0,
                            "total_pages": 0,
                            "has_next": False,
                            "has_previous": page > 1,
                        },
                    }
                )

            # Sort folder entries by name first
            folder_entries.sort(key=lambda x: x[0].lower())

            # Apply pagination to folder entries before querying database
            total_folders_all = len(folder_entries)
            total_pages_all = (
                total_folders_all + page_size - 1
            ) // page_size  # Ceiling division

            start_idx = (page - 1) * page_size
            end_idx = start_idx + page_size
            paginated_entries = folder_entries[start_idx:end_idx]

            # Early return if no folders in this page
            if not paginated_entries:
                if is_admin:
                    parent_path = (
                        os.path.dirname(base_path)
                        if base_path != settings.DATA_ROOT
                        else None
                    )
                else:
                    parent_path = (
                        os.path.dirname(base_path)
                        if base_path != request.user.scan_directory
                        else None
                    )
                return Response(
                    {
                        "current_path": base_path,
                        "parent_path": parent_path,
                        "subfolders": [],
                        "pagination": {
                            "page": page,
                            "page_size": page_size,
                            "total_folders": total_folders_all,
                            "total_pages": total_pages_all,
                            "has_next": page < total_pages_all,
                            "has_previous": page > 1,
                        },
                    }
                )

            # Query database only for the folders we need (paginated ones)
            aggregates = {}
            for idx, (_, folder_path, _) in enumerate(paginated_entries):
                aggregates[f"count_{idx}"] = Count(
                    "pk", filter=Q(files__path__startswith=folder_path), distinct=True
                )

            counts = Photo.objects.filter(owner=request.user).aggregate(**aggregates)

            # Build response for paginated folders
            paginated_subfolders = []
            for idx, (name, folder_path, mtime) in enumerate(paginated_entries):
                photo_count = counts.get(f"count_{idx}", 0) or 0
                if photo_count > 0:
                    paginated_subfolders.append(
                        {
                            "name": name,
                            "path": folder_path,
                            "photo_count": photo_count,
                            "modified": mtime,
                        }
                    )

            # Calculate parent path respecting user permissions
            if is_admin:
                parent_path = (
                    os.path.dirname(base_path)
                    if base_path != settings.DATA_ROOT
                    else None
                )
            else:
                parent_path = (
                    os.path.dirname(base_path)
                    if base_path != request.user.scan_directory
                    else None
                )

            return Response(
                {
                    "current_path": base_path,
                    "parent_path": parent_path,
                    "subfolders": paginated_subfolders,
                    "pagination": {
                        "page": page,
                        "page_size": page_size,
                        "total_folders": total_folders_all,
                        "total_pages": total_pages_all,
                        "has_next": page < total_pages_all,
                        "has_previous": page > 1,
                    },
                }
            )

        except Exception as e:
            logger.error(f"Error scanning directory {base_path}: {e}")
            return Response({"error": "Error scanning directory"}, status=500)
