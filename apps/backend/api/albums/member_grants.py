"""What a member of a shared album sees of the photos in it (#464).

A photo someone reads only because it is in an album they own or are a
member of (not their own, not shared to them directly, not public, not in a
library its owner shares with them) is shown through the album's rules: its
date and pixels always, each of location, people's names, camera
information, captions and the original file only where *both* sides allow
it (the "both must allow" rule):

* the album owner's ceiling for the album (``AlbumUser.members_share_*``);
* the photo owner's own choice: for a contributor's photo, the switches of
  their membership (``AlbumUserMember.share_*``, off until they turn them
  on); for the album owner's photo, the owner set the ceiling themselves,
  and people's names also need their ``share_people_names``, as before.

A photo in several such albums shows what any of them allows: the viewer
sees it in each. The answer is a ``LibraryGrant``, so the redaction is the
library share's (#2731): ``api.sharing.grants.redact`` with its field tables,
which hide any field they do not list. When the photo's owner shares their
whole library with the viewer, that share decides instead.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import fields
from typing import Final

from django.contrib.auth.models import AnonymousUser
from django.db.models import QuerySet

from api.models import AlbumUser, AlbumUserMember, AlbumUserPhoto, Photo, User
from api.sharing.grants import LibraryGrant

NOTHING: Final = LibraryGrant()


def either(a: LibraryGrant, b: LibraryGrant) -> LibraryGrant:
    """What two albums show between them: each field either allows."""
    return LibraryGrant(
        **{f.name: getattr(a, f.name) or getattr(b, f.name) for f in fields(a)}
    )


def both(a: LibraryGrant, b: LibraryGrant) -> LibraryGrant:
    """Both must allow: each field only where both sides allow it."""
    return LibraryGrant(
        **{f.name: getattr(a, f.name) and getattr(b, f.name) for f in fields(a)}
    )


# Grant attribute -> the column suffix of the album's ceiling
# (``members_<suffix>``) and of a membership's switch (``<suffix>``).
COLUMNS: Final = {
    "location": "share_location",
    "people": "share_faces",
    "camera": "share_camera_info",
    "captions": "share_captions",
    "originals": "share_originals",
}


def contributor_choice(member: AlbumUserMember | None) -> LibraryGrant:
    """What a contributor lets the members see of the photos they add.

    No membership (they left meanwhile): nothing.
    """
    if member is None:
        return NOTHING
    return LibraryGrant(
        **{name: getattr(member, column) for name, column in COLUMNS.items()}
    )


def _account(viewer: User | AnonymousUser | None) -> User | None:
    if isinstance(viewer, User) and viewer.is_authenticated:
        return viewer
    return None


def seen_links(
    viewer: User | AnonymousUser | None, album: AlbumUser | None = None
) -> QuerySet[AlbumUserPhoto]:
    """The vouched album links through which ``viewer`` sees photos.

    In the albums they own or are a member of; only ``album`` when given.
    """
    albums = AlbumUser.objects.owned_or_shared_to(_account(viewer))
    if album is not None:
        albums = albums.filter(pk=album.pk)
    return AlbumUserPhoto.objects.vouched().filter(albumuser__in=albums)


def photos_seen_through_albums(viewer: User | AnonymousUser | None) -> QuerySet[Photo]:
    """Every photo ``viewer`` sees in an album they own or are a member of."""
    return Photo.objects.filter(pk__in=seen_links(viewer).values("photo_id"))


_LINK_COLUMNS = (
    "photo_id",
    "albumuser_id",
    "albumuser__owner_id",
    "photo__owner_id",
    "photo__owner__share_people_names",
    *(f"albumuser__members_{column}" for column in COLUMNS.values()),
)


def album_grants(
    viewer: User | AnonymousUser | None,
    photo_ids: Iterable[object],
    album: AlbumUser | None = None,
) -> dict[object, LibraryGrant]:
    """Photo id -> what ``viewer`` sees of it through albums; two queries.

    Photos ``viewer`` reaches through no album are missing from the answer.
    """
    links = list(
        seen_links(viewer, album)
        .filter(photo_id__in=list(photo_ids))
        .values(*_LINK_COLUMNS)
    )
    members: dict[tuple[object, object], AlbumUserMember] = {
        (m.albumuser_id, m.user_id): m
        for m in AlbumUserMember.objects.filter(
            albumuser_id__in={link["albumuser_id"] for link in links},
            user_id__in={link["photo__owner_id"] for link in links},
        )
    }
    grants: dict[object, LibraryGrant] = {}
    for link in links:
        grant = both(_link_ceiling(link), _owner_choice(link, members))
        photo_id = link["photo_id"]
        grants[photo_id] = either(grants.get(photo_id, NOTHING), grant)
    return grants


def _link_ceiling(link: Mapping[str, object]) -> LibraryGrant:
    return LibraryGrant(
        **{
            name: bool(link[f"albumuser__members_{column}"])
            for name, column in COLUMNS.items()
        }
    )


def _owner_choice(
    link: Mapping[str, object],
    members: Mapping[tuple[object, object], AlbumUserMember],
) -> LibraryGrant:
    """The photo owner's side of the rule for one link."""
    owner_id = link["photo__owner_id"]
    if owner_id == link["albumuser__owner_id"]:
        names = bool(link["photo__owner__share_people_names"])
        return LibraryGrant(True, names, True, True, True)
    return contributor_choice(members.get((link["albumuser_id"], owner_id)))
