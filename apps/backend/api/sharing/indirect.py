"""Photos a user reads through something else that was shared with them.

Besides a share of the photo itself, a public link or a shared library: an
album they own or are a member of (#464, ``member_grants``). It answers with
the ``LibraryGrant`` of what may be shown. A library share of the photo's
owner, when there is one, decides instead (``grants.library_grant``); the
callers ask it first.
"""

from __future__ import annotations

from collections.abc import Iterable, MutableMapping
from uuid import UUID

from django.contrib.auth.models import AnonymousUser

from api.albums.member_grants import album_grants
from api.models import Photo, User
from api.sharing.grants import SUMMARY_FIELDS, GrantLookup, LibraryGrant, redact


def indirect_grants(
    viewer: User | AnonymousUser | None, photo_ids: Iterable[object]
) -> dict[object, LibraryGrant]:
    """Photo id -> what ``viewer`` sees of it through albums.

    Photos reached no such way are missing from the answer.
    """
    return album_grants(viewer, list(photo_ids))


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
    ``viewer`` reads only through an album (#464).

    Each row shows what the album's "What members see" allows
    (``indirect_grants``). A photo shared with them one by one keeps what
    that share shows; a library share of the owner already redacted its rows
    (``PhotoSummarySerializer``), and decides.
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
