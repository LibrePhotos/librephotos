"""Which photos a date-grouped view shows: one definition for the day list,
a day's photos and its layout, so a day's count, its pages and its layout
always agree.

Every condition is a column of the photo, a one-to-one join (thumbnail, main
file) or an ``EXISTS``: nothing repeats a photo, so a count needs no DISTINCT
and a page no sort of the whole day.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from django.contrib.auth.models import AnonymousUser
from django.db.models import Exists, OuterRef, Q, QuerySet

from api.albums.timeline_filter import timeline_filter_q
from api.models import Face, LibraryShare, Photo, PhotoStack, User
from api.models.user import public_sharing_settings
from api.photos.paths import folder_path_q
from api.sharing.library_photos import library_photos_q, library_share, timeline_shares


@dataclass(frozen=True)
class TimelineView:
    """The photos of a view and how it groups them.

    ``photos``: every photo the view shows, of every day.
    ``undated_only``: one undated group of all of them (the public view of an
    owner who keeps dates to themselves), in an order that says nothing
    about when they were taken.
    ``place_owners``: whose photos may name a day's place.
    """

    photos: QuerySet[Photo]
    order: str
    undated_only: bool = False
    place_owners: frozenset[int] = frozenset()


def shown_in_stack_q() -> Q:
    """Photos in no stack, or the primary photo of theirs: the others stay
    out of the timeline and are reached by opening the stack."""
    in_no_stack = ~Exists(Photo.stacks.through.objects.filter(photo_id=OuterRef("pk")))
    is_primary = Exists(PhotoStack.objects.filter(primary_photo_id=OuterRef("pk")))
    return in_no_stack | is_primary


def _view_filters(user: User | AnonymousUser, params: Mapping[str, Any]) -> Q:
    """The conditions of ``params`` on the requester's own (or the public
    view's) photos."""
    q = Q(
        main_file__isnull=False,
        thumbnail__aspect_ratio__isnull=False,
        hidden=params["hidden"],
    )
    for condition in timeline_filter_q(user, params):
        q &= condition
    if params["in_trashcan"]:
        q &= Q(in_trashcan=True, removed=False)
    else:
        q &= Q(in_trashcan=False)
    if not params["show_all_stack_photos"]:
        q &= shown_in_stack_q()
    if params["folder"]:
        files = Photo.files.through.objects.filter(
            folder_path_q("file__path", params["folder"]), photo_id=OuterRef("pk")
        )
        q &= Q(Exists(files))
    if params.get("person") is not None:
        faces = Face.objects.filter(
            photo_id=OuterRef("pk"), person_id=params["person"], deleted=False
        )
        q &= Q(Exists(faces))
    return q


def public_view(owner: User, params: Mapping[str, Any]) -> TimelineView:
    """The public photos of ``owner`` (``params`` already as the public view
    reads them: ``public_view_filters``), as their public page shows them."""
    switches = public_sharing_settings(owner)
    photos = Photo.objects.filter(
        Photo.objects.owner_q(owner),
        _view_filters(AnonymousUser(), params),
        public=True,
    )
    return TimelineView(
        photos,
        params["order"],
        undated_only=not switches["share_timestamps"],
        place_owners=frozenset({owner.pk})
        if switches["share_location"]
        else frozenset(),
    )


def library_view(user: User, params: Mapping[str, Any]) -> TimelineView:
    """The library another user shares with ``user`` (``params["library"]``)."""
    share = library_share(user, params["library"])
    q = library_photos_q(user, params, LibraryShare.objects.filter(pk=share.pk))
    photos = (
        Photo.objects.filter(q, main_file__isnull=False)
        if q is not None
        else Photo.objects.none()
    )
    places = frozenset({share.owner_id}) if share.share_location else frozenset()
    return TimelineView(photos, params["order"], place_owners=places)


def own_view(user: User, params: Mapping[str, Any]) -> TimelineView:
    """``user``'s own photos, with the libraries they show in their timeline
    when ``params["libraries"]`` asks for them."""
    match = Photo.objects.owner_q(user) & _view_filters(user, params)
    places = {user.pk}
    if params["libraries"]:
        shares = list(timeline_shares(user))
        shared = library_photos_q(
            user, params, LibraryShare.objects.filter(pk__in=[s.pk for s in shares])
        )
        if shares and shared is not None:
            match |= shared & Q(main_file__isnull=False)
            places |= {share.owner_id for share in shares if share.share_location}
    return TimelineView(
        Photo.objects.filter(match), params["order"], place_owners=frozenset(places)
    )
