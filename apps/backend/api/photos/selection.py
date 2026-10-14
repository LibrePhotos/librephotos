"""The photos a server-side "Select All" acts on, built from its filter payload.

Bulk endpoints (trash, favorite, hide, share, tag, album, download) take the
filter instead of every photo id; ``build_photo_queryset`` turns it into the
user's own photos.
"""

from collections.abc import Mapping
from typing import Any

from django.contrib.auth.models import AnonymousUser
from django.db.models import Exists, OuterRef, Q, QuerySet

from api.albums.timeline_filter import parse_tristate, timeline_filter_q
from api.models import AlbumUser, Photo
from api.models.user import User
from api.photos.paths import folder_path_q
from api.search.metadata_filter import metadata_filter_q, parse_metadata_filter


def not_in_own_album_q(user: User | AnonymousUser | None) -> Q:
    """Photos in none of ``user``'s own albums (#530).

    An album another user shares with ``user`` does not count: the photo is
    still unsorted in the requester's own library.
    """
    in_own_album = AlbumUser.objects.owned_by(user).filter(photos=OuterRef("pk"))
    return ~Q(Exists(in_own_album))


def build_photo_queryset(
    user: User | AnonymousUser, params: Mapping[str, Any]
) -> QuerySet[Photo]:
    """The user's own photos matching a select_all ``query`` payload.

    This is the write scope behind every server-side "Select All" mutation
    (trash, favorite, hide, share, tag, album, download), so it is always
    bound to ``user``: no key in ``params`` can widen it to another user's
    photos. Public browsing of other users' photos is a read concern and
    lives in the timeline view, not here.

    Args:
        user: The authenticated user making the request
        params: Dictionary of filter parameters:
            - public: bool - Only the user's photos that are marked public
            - hidden: bool - Filter by hidden photos
            - in_trashcan: bool - Filter by trashed photos
            - media, video, photo, is_screenshot, is_document,
              hide_screenshots, hide_documents, favorite, archived,
              apply_default -
              the timeline filter, resolved by api.albums.timeline_filter exactly as
              the date-album endpoints resolve it, so select-all on the
              timeline acts on what it shows
            - person: int or list of int - Only photos showing every one of
              these people (the user's own; another id is a 400)
            - camera, make, lens, iso_min, iso_max, aperture_min,
              aperture_max, focal_min, focal_max, focal35_min, focal35_max,
              rating_min, taken_after, taken_before, has_location,
              file_type, extension - the structured search filters of
              ``api.search.metadata_filter.MetadataFilterQuery``; a bad
              value is a 400 on ``query``. The free-text ``search`` term is
              not part of a select-all. Search lists every photo of a stack,
              so a select-all after a search also sends
              ``show_all_stack_photos``.
            - tag: int - Filter by tag ID
            - folder: str - Filter by folder path prefix
            - no_timestamp: bool - Only photos without a date (``exif_timestamp``
              unset), the "Photos without Timestamps" page. That page lists
              stacked photos too, so its select-all also sends
              ``show_all_stack_photos``.
            - no_album: bool - Only photos in none of the user's own albums
            - show_all_stack_photos: bool - If True, show all photos in stacks (default: False)

    Returns:
        QuerySet[Photo]: Filtered photo queryset
    """
    filters = [Q(thumbnail__aspect_ratio__isnull=False)]

    # Media type, screenshots, documents and favorites
    filters += timeline_filter_q(user, params)

    if params.get("public"):
        filters.append(Q(public=True))

    # Hidden filter
    if params.get("hidden"):
        filters.append(Q(hidden=True))
    else:
        filters.append(Q(hidden=False))

    # Trashcan filter
    if params.get("in_trashcan"):
        filters.append(Q(in_trashcan=True) & Q(removed=False))
    else:
        filters.append(Q(in_trashcan=False))

    # Camera, exposure, rating, dates, location, file type and people: the
    # structured search filters, read exactly as search reads them so a
    # select-all after a filtered search acts on what it listed. ``person``
    # (one id or a list, every one of them in the photo) is among them.
    filters += metadata_filter_q(parse_metadata_filter(user, params, "query"))

    # Tag filter
    if params.get("tag"):
        filters.append(Q(tags__id=params["tag"]))

    # Folder path filter
    if params.get("folder"):
        filters.append(folder_path_q("files__path", params["folder"]))

    # Photos without a date ("Photos without Timestamps"). Only a true flag
    # narrows: "false" from a client must not read as true.
    if parse_tristate(params.get("no_timestamp")):
        filters.append(Q(exif_timestamp__isnull=True))

    if parse_tristate(params.get("no_album")):
        filters.append(not_in_own_album_q(user))

    # Stack filtering: Show photos that are either:
    # 1. Not in any stack, OR
    # 2. The primary photo of their stack
    # This applies stacking behavior for ALL stack types (manual, burst, etc.)
    # Non-primary photos are hidden in the timeline but accessible via stack expansion
    if not params.get("show_all_stack_photos"):
        filters.append(Q(stacks__isnull=True) | Q(primary_in_stack__isnull=False))

    return Photo.objects.owned_by(user).filter(*filters).distinct()


def selected_photos(
    user: User | AnonymousUser, selection: Mapping[str, Any]
) -> QuerySet[Photo]:
    """The user's own photos a validated ``PhotoSelectionRequest`` names:
    its ``image_hashes``, or with ``select_all`` its ``query`` minus the
    ``excluded_hashes``."""
    if not selection["select_all"]:
        return Photo.objects.owned_by(user).filter(
            image_hash__in=selection["image_hashes"]
        )
    photos = build_photo_queryset(user, selection["query"])
    excluded_hashes = selection["excluded_hashes"]
    if excluded_hashes:
        photos = photos.exclude(image_hash__in=excluded_hashes)
    return photos
