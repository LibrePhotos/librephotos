"""The photos of a shared library as the recipient's pages reach them (#2731).

Two ways in, both through the date-grouped lists (``api.timeline``):

* ``library=<owner id>``: one owner's library page, read-only, archived
  photos included (as the owner's own library lists them);
* ``libraries=true``: the recipient's timeline with the libraries they turned
  "Show in my timeline" on for. A day both have is one day.

Views of what only the owner has (hidden photos, the trash, a public page,
folders, a person, a search, the sync feed) or of what is never shared
(favourites) never take another user's photos: ``library_photos_q`` answers
None for them, so no filter can be used to learn a hidden field.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from django.db.models import Exists, OuterRef, Q, QuerySet
from rest_framework.exceptions import NotFound

from api.albums.timeline_filter import resolve_timeline_filter
from api.models import LibraryShare, Photo, PhotoStack, User
from api.models.photo import shared_library_q

# Params that make a day-album read a view of the requester's own library.
OWNER_ONLY_PARAMS = (
    "hidden",
    "in_trashcan",
    "public",
    "username",
    "folder",
    "person",
    "search",
    "last_modified",
)


def owner_only_view(params: Mapping[str, Any]) -> bool:
    """Whether ``params`` ask for a view no library photo belongs in."""
    return any(params.get(name) not in (None, "", False) for name in OWNER_ONLY_PARAMS)


def timeline_shares(user: User) -> QuerySet[LibraryShare]:
    """The libraries ``user`` shows in their timeline."""
    return LibraryShare.objects.received_by(user).filter(show_in_timeline=True)


def library_share(user: User, owner_id: int) -> LibraryShare:
    """The share of ``owner_id``'s library with ``user``; a 404 without one."""
    share = (
        LibraryShare.objects.received_by(user)
        .filter(owner_id=owner_id)  # owner-scope: the library asked for
        .select_related("owner")
        .first()
    )
    if share is None:
        raise NotFound("No such library shared with you")
    return share


def _stack_q(prefix: str) -> Q:
    """Photos in no stack, or the primary of theirs, as the timeline shows."""
    in_no_stack = ~Exists(Photo.stacks.through.objects.filter(photo_id=OuterRef("pk")))
    is_primary = Exists(PhotoStack.objects.filter(primary_photo_id=OuterRef("pk")))
    shown = Photo.objects.filter(in_no_stack | is_primary).values("pk")
    return Q(**{f"{prefix}pk__in": shown})


def library_photos_q(
    user: User,
    params: Mapping[str, Any],
    shares: QuerySet[LibraryShare],
    prefix: str = "",
) -> Q | None:
    """The photos of ``shares`` a day-album read with ``params`` shows.

    None when the read takes no library photos at all (``owner_only_view``,
    or a favourites filter: ratings are never shared). The media filters
    (photos, videos, screenshots, documents, archived) apply as on the
    requester's own photos.
    """
    if owner_only_view(params):
        return None
    timeline_filter = resolve_timeline_filter(user, params)
    if timeline_filter.favorites:
        return None
    q = shared_library_q(user, shares, prefix) & Q(
        **{f"{prefix}thumbnail__aspect_ratio__isnull": False}
    )
    for condition in timeline_filter.q(user, prefix=prefix):
        q &= condition
    if not params.get("show_all_stack_photos"):
        q &= _stack_q(prefix)
    return q
