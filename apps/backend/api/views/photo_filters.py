"""
Photo filtering utilities for bulk operations.

This module provides reusable functions to build photo querysets from filter parameters,
enabling server-side "Select All" operations without sending individual photo IDs.
"""

from django.db.models import Q

from api.models import Photo


def build_photo_queryset(user, params: dict):
    """Build a Photo queryset from filter parameters.

    This function reuses the same filtering logic as AlbumDateListViewSet to ensure
    consistency between what users see in the UI and what bulk operations affect.

    Args:
        user: The authenticated user making the request
        params: Dictionary of filter parameters:
            - favorite: bool - Filter by favorite status (rating >= user.favorite_min_rating)
            - public: bool - Filter by public photos only
            - hidden: bool - Filter by hidden photos
            - in_trashcan: bool - Filter by trashed photos
            - video: bool - Filter by videos only
            - photo: bool - Filter by photos only (non-videos)
            - person: int - Filter by person ID (faces)
            - folder: str - Filter by folder path prefix
            - username: str - Filter by owner username (for public photos)

    Returns:
        QuerySet[Photo]: Filtered photo queryset
    """
    filters = [Q(thumbnail__aspect_ratio__isnull=False)]

    # Owner filter - default to current user unless viewing public photos
    if not params.get("public"):
        filters.append(Q(owner=user))

    # Favorite filter
    if params.get("favorite"):
        min_rating = user.favorite_min_rating
        filters.append(Q(rating__gte=min_rating))

    # Public photos filter
    if params.get("public"):
        if params.get("username"):
            filters.append(Q(owner__username=params["username"]))
        filters.append(Q(public=True))

    # Hidden filter
    if params.get("hidden"):
        filters.append(Q(hidden=True))
    else:
        filters.append(Q(hidden=False))

    # Video/photo type filter
    if params.get("video"):
        filters.append(Q(video=True))
    elif params.get("photo"):
        filters.append(Q(video=False))

    # Trashcan filter
    if params.get("in_trashcan"):
        filters.append(Q(in_trashcan=True) & Q(removed=False))
    else:
        filters.append(Q(in_trashcan=False))

    # Person/face filter
    if params.get("person"):
        filters.append(Q(faces__person__id=params["person"]))

    # Folder path filter
    if params.get("folder"):
        filters.append(Q(files__path__startswith=params["folder"]))

    return Photo.objects.filter(*filters).distinct()

