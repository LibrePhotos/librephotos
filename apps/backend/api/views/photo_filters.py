"""
Photo filtering utilities for bulk operations.

This module provides reusable functions to build photo querysets from filter parameters,
enabling server-side "Select All" operations without sending individual photo IDs.
"""

from django.db.models import Q

from api.models import Photo


def build_photo_queryset(user, params: dict):
    """The user's own photos matching a select_all ``query`` payload.

    This is the write scope behind every server-side "Select All" mutation
    (trash, favorite, hide, share, tag, album, download), so it is always
    bound to ``user``: no key in ``params`` can widen it to another user's
    photos. Public browsing of other users' photos is a read concern and
    lives in the timeline view, not here.

    Args:
        user: The authenticated user making the request
        params: Dictionary of filter parameters:
            - favorite: bool - Filter by favorite status (rating >= user.favorite_min_rating)
            - public: bool - Only the user's photos that are marked public
            - hidden: bool - Filter by hidden photos
            - in_trashcan: bool - Filter by trashed photos
            - video: bool - Filter by videos only
            - photo: bool - Filter by photos only (non-videos)
            - is_screenshot: bool - Filter by screenshots only
            - is_document: bool - Filter by documents only
            - person: int - Filter by person ID (faces)
            - tag: int - Filter by tag ID
            - folder: str - Filter by folder path prefix
            - show_all_stack_photos: bool - If True, show all photos in stacks (default: False)

    Returns:
        QuerySet[Photo]: Filtered photo queryset
    """
    filters = [Q(thumbnail__aspect_ratio__isnull=False)]

    # Favorite filter
    if params.get("favorite"):
        min_rating = user.favorite_min_rating
        filters.append(Q(rating__gte=min_rating))

    if params.get("public"):
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

    # Media-category filters (mirrors the video param convention)
    if params.get("is_screenshot"):
        filters.append(Q(is_screenshot=True))
    if params.get("is_document"):
        filters.append(Q(is_document=True))

    # Trashcan filter
    if params.get("in_trashcan"):
        filters.append(Q(in_trashcan=True) & Q(removed=False))
    else:
        filters.append(Q(in_trashcan=False))

    # Person/face filter
    if params.get("person"):
        filters.append(Q(faces__person__id=params["person"]))

    # Tag filter
    if params.get("tag"):
        filters.append(Q(tags__id=params["tag"]))

    # Folder path filter
    if params.get("folder"):
        filters.append(Q(files__path__startswith=params["folder"]))

    # Stack filtering: Show photos that are either:
    # 1. Not in any stack, OR
    # 2. The primary photo of their stack
    # This applies stacking behavior for ALL stack types (manual, burst, etc.)
    # Non-primary photos are hidden in the timeline but accessible via stack expansion
    if not params.get("show_all_stack_photos"):
        filters.append(Q(stacks__isnull=True) | Q(primary_in_stack__isnull=False))

    return Photo.objects.owned_by(user).filter(*filters).distinct()
