"""Search over the libraries a user shows in their timeline (#2731).

A search must not find what a share hides: a place name finds another
user's photos only when that user shares locations with the searcher, a
person's name only when they share people's names, a caption or OCR text
only with captions, a camera only with camera information. What the photo
shows (its things, the OpenCLIP tags) is always searchable, since the photo
itself is shared. File names, folders, keywords, tags and ratings never are.

The structured search filters (camera, exposure, rating, location, file
type, people) are owner-only: a search that uses one finds none of the
shared photos, so no filter can be used to probe a hidden field.
"""

from __future__ import annotations

import operator
from collections.abc import Iterable, Sequence
from functools import reduce

from django.db.models import F, Q, QuerySet

from api.models import AlbumThing, Face, LibraryShare, Person, Photo, User
from api.models.photo import shared_library_q
from api.search.semantic import TAG_THING_TYPE
from api.sharing.grants import LibraryGrant
from api.sharing.library_photos import timeline_shares


def _things_q(term: str) -> Q:
    """Photos in a thing album (an OpenCLIP tag) whose title holds ``term``."""
    links = AlbumThing.photos.through.objects.filter(
        albumthing__thing_type=TAG_THING_TYPE, albumthing__title__icontains=term
    )
    return Q(pk__in=links.values("photo_id"))


def _people_q(term: str) -> Q:
    """Photos showing a person their owner named, whose name holds ``term``."""
    faces = Face.objects.filter(
        deleted=False,
        person__kind=Person.KIND_USER,
        person__name__icontains=term,
        # owner-scope: the person must be the photo owner's, not a scope to a user
        person__cluster_owner=F("photo__owner"),
    )
    return Q(pk__in=faces.values("photo_id"))


def term_q(term: str, grant: LibraryGrant) -> Q:
    """The shared photos ``term`` finds under ``grant``."""
    q = _things_q(term)
    if grant.location:
        q |= Q(search_instance__search_location__icontains=term)
    if grant.captions:
        q |= Q(caption_instance__captions_json__icontains=term)
        q |= Q(ocr__text__icontains=term)
    if grant.people:
        q |= _people_q(term)
    if grant.camera:
        q |= Q(metadata__camera_make__icontains=term)
        q |= Q(metadata__camera_model__icontains=term)
        q |= Q(metadata__lens_model__icontains=term)
    return q


def _share_q(user: User, share: LibraryShare, terms: Sequence[str]) -> Q:
    grant = LibraryGrant.of(share)
    shares = LibraryShare.objects.filter(pk=share.pk)
    return reduce(
        operator.and_,
        (term_q(term, grant) for term in terms),
        shared_library_q(user, shares),
    )


def library_matches(
    user: User,
    terms: Sequence[str],
    media_q: Iterable[Q],
    owner_only_filters: bool,
) -> QuerySet[Photo] | None:
    """The shared photos a search for every one of ``terms`` finds.

    None without a term, with a structured filter (``owner_only_filters``)
    or when no library is in ``user``'s timeline. ``media_q`` is the media
    filter (photos, videos, screenshots, documents), applied as on the
    searcher's own photos.
    """
    if not terms or owner_only_filters:
        return None
    shares = list(timeline_shares(user))
    if not shares:
        return None
    match = reduce(operator.or_, (_share_q(user, share, terms) for share in shares))
    return Photo.visible.filter(match, *media_q)
