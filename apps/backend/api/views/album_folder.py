import os
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from django.conf import settings

from api.util import logger
from api.models.photo import Photo


class FolderNavigationViewSet(viewsets.ViewSet):
    """
    ViewSet for folder navigation functionality.
    Returns subfolders for a given path.

    Security:
    - Admins (is_staff=True) can access all folders within DATA_ROOT
    - Regular users can only access folders within their scan_directory
    - All paths are validated to prevent directory traversal attacks
    """

    permission_classes = [IsAuthenticated]

    @action(detail=False, methods=["get"])
    def subfolders(self, request):
        """Get subfolders for a given path."""
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
            subfolders = []
            for item in os.scandir(base_path):
                if item.is_dir() and not item.name.startswith("."):
                    item_path = item.path
                    # Count photos in this folder
                    photo_count = (
                        Photo.objects.filter(
                            owner=request.user, files__path__startswith=item_path
                        )
                        .distinct()
                        .count()
                    )

                    if photo_count > 0:  # Only include folders with photos
                        subfolders.append(
                            {
                                "name": item.name,
                                "path": item_path,
                                "photo_count": photo_count,
                                "modified": os.path.getmtime(item_path),
                            }
                        )

            # Sort by name
            subfolders.sort(key=lambda x: x["name"].lower())

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
                    "subfolders": subfolders,
                }
            )

        except Exception as e:
            logger.error(f"Error scanning directory {base_path}: {e}")
            return Response({"error": "Error scanning directory"}, status=500)
