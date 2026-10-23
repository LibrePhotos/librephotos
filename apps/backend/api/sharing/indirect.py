"""Photos a user reads through something else that was shared with them.

Two ways besides a share of the photo itself, a public link or a shared
library: an album they own or are a member of (#464, ``member_grants``) and a
person someone shared with them (#668, ``person_shares``). Each answers with
the ``LibraryGrant`` of what may be shown; a photo reached both ways shows
what either allows. A library share of the photo's owner, when there is one,
decides instead (``grants.library_grant``); the callers ask it first.
"""

from __future__ import annotations

from collections.abc import Iterable, MutableMapping
from uuid import UUID

from django.contrib.auth.models import AnonymousUser
from django.db.models import Q, QuerySet

from api.albums.member_grants import album_grants, either, photos_seen_through_albums
from api.faces.person_shares import person_grants, photos_seen_through_people
from api.models import Photo, User
from api.sharing.grants import SUMMARY_FIELDS, GrantLookup, LibraryGrant, redact


def indirect_grants(
    viewer: User | AnonymousUser | None, photo_ids: Iterable[object]
) -> dict[object, LibraryGrant]:
    """Photo id -> what ``viewer`` sees of it through albums and people.

    Photos reached neither way are missing from the answer.
    """
    ids = list(photo_ids)
    grants = album_grants(viewer, ids)
    for photo_id, grant in person_grants(viewer, ids).items():
        seen = grants.get(photo_id)
        grants[photo_id] = grant if seen is None else either(seen, grant)
    return grants


def photos_seen_indirectly(viewer: User | AnonymousUser | None) -> QuerySet[Photo]:
    """Every photo ``viewer`` sees through an album or a shared person."""
    return Photo.objects.filter(
        Q(pk__in=photos_seen_through_albums(viewer).values("pk"))
        | Q(pk__in=photos_seen_through_people(viewer).values("pk"))
    )


def _directly_shared(viewer: User | AnonymousUser | None, ids: list[UUID]) -> set[UUID]:
    """The photos among ``ids`` their owners shared with ``viewer`` one by one."""
    if not (isinstance(viewer, User) and viewer.is_authenticated):
        return set()
    return set(
        Photo.shared_to.through.objects.filter(user=viewer, photo_id__in=ids)
        .exclude(Photo.objects.owner_q(viewer, through="photo__"))
        .values_list("photo_id", flat=True)
    )


def redact_indirect_rows(
    rows: list[MutableMapping[str, object]], viewer: User | AnonymousUser | None
) -> None:
    """Redact, in place, the photo summaries of a "Shared with you" list that
    ``viewer`` reads only through an album (#464) or a shared person (#668).

    Each row shows what those allow (``indirect_grants``): an album's "What
    members see", a person's switches. A photo shared with them one by one
    keeps what that share shows; a library share of the owner already
    redacted its rows (``PhotoSummarySerializer``), and decides.
    """
    ids = [UUID(str(row["id"])) for row in rows]
    plain = _directly_shared(viewer, ids)
    library = GrantLookup(viewer)
    grants = indirect_grants(viewer, ids)
    for row, photo_id in zip(rows, ids, strict=True):
        owner = row.get("owner")
        owner_id = owner.get("id") if isinstance(owner, dict) else None
        if photo_id in plain or library.for_owner(owner_id) is not None:
            continue
        redact(row, SUMMARY_FIELDS, grants.get(photo_id, LibraryGrant()))
