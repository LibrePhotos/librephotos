"""What the recipient of a library share sees of each of the owner's photos.

One rule for every response that carries a photo: when the owner shares
their library with the viewer, the share's switches decide which fields the
viewer gets, for every photo of that owner, including photos the owner also
shared one by one or in an album. The photos and their dates are always
shared; location, the names of named people, camera information, captions
and original files only when the owner turned that switch on; hidden photos,
albums, tags, favourites and ratings, edit history, file names and folders
never.

The field tables below list every field of the two photo serializers. A field
missing from a table is hidden from recipients (``NEVER``), and
``api/tests/sharing_and_public/test_library_share_redaction.py`` fails until
a new field is put in one, so a new field is a decision, not a leak.
"""

from __future__ import annotations

from collections.abc import Mapping, MutableMapping
from dataclasses import dataclass
from typing import Final, Literal

from django.contrib.auth.models import AnonymousUser
from django.db.models import QuerySet
from rest_framework.serializers import BaseSerializer

from api.models import LibraryShare, User

Switch = Literal[
    "always", "never", "location", "people", "camera", "captions", "originals"
]
ALWAYS: Final = "always"
NEVER: Final = "never"


@dataclass(frozen=True)
class LibraryGrant:
    """The owner's switches for one recipient."""

    location: bool = False
    people: bool = False
    camera: bool = False
    captions: bool = False
    originals: bool = False

    @classmethod
    def of(cls, share: LibraryShare) -> LibraryGrant:
        return cls(
            location=share.share_location,
            people=share.share_faces,
            camera=share.share_camera_info,
            captions=share.share_captions,
            originals=share.share_originals,
        )

    def allows(self, switch: Switch) -> bool:
        if switch == ALWAYS:
            return True
        if switch == NEVER:
            return False
        return bool(getattr(self, switch))

    def as_dict(self) -> dict[str, bool]:
        return {
            "location": self.location,
            "people": self.people,
            "camera": self.camera,
            "captions": self.captions,
            "originals": self.originals,
        }


def _account(viewer: User | AnonymousUser | None) -> User | None:
    if isinstance(viewer, User) and viewer.is_authenticated:
        return viewer
    return None


def received_grants(viewer: User | AnonymousUser | None) -> dict[int, LibraryGrant]:
    """Owner id -> grant, for every library shared with ``viewer``; one query."""
    shares = LibraryShare.objects.received_by(_account(viewer))
    return {share.owner_id: LibraryGrant.of(share) for share in shares}


def library_grant(
    viewer: User | AnonymousUser | None, owner_id: int | None
) -> LibraryGrant | None:
    """The grant ``viewer`` has on ``owner_id``'s photos, or None.

    None means the library rules do not apply: the viewer owns the photo, or
    reads it some other way (a share of the photo or an album, a public link)
    from an owner who does not share their library with them.
    """
    account = _account(viewer)
    if account is None or owner_id is None or owner_id == account.pk:
        return None
    share = (
        LibraryShare.objects.received_by(account)
        .filter(owner_id=owner_id)  # owner-scope: the photo's owner
        .first()
    )
    return LibraryGrant.of(share) if share is not None else None


def without_switch(
    viewer: User | AnonymousUser | None, switch: str
) -> QuerySet[LibraryShare, int]:
    """The owner ids whose library share with ``viewer`` has ``switch`` off.

    Their photos shared one by one or in an album follow the library share
    too, so the "Shared with you" places and people leave them out.
    """
    return (
        LibraryShare.objects.received_by(_account(viewer))
        .filter(**{switch: False})
        .values_list("owner_id", flat=True)
    )


class GrantLookup:
    """``library_grant`` for many photos of one viewer: one query in all."""

    def __init__(self, viewer: User | AnonymousUser | None) -> None:
        self._viewer = _account(viewer)
        self._grants: dict[int, LibraryGrant] | None = None

    def for_owner(self, owner_id: int | None) -> LibraryGrant | None:
        if self._viewer is None or owner_id is None or owner_id == self._viewer.pk:
            return None
        if self._grants is None:
            self._grants = received_grants(self._viewer)
        return self._grants.get(owner_id)


_LOOKUP_ATTR = "_library_grant_lookup"


def lookup_for(serializer: BaseSerializer) -> GrantLookup:
    """The ``GrantLookup`` of the user ``serializer``'s request is for.

    Kept on the root serializer, which a list serializer's child shares, so a
    page of photos costs one query. Without a request there is no viewer and
    nothing to redact: every view that can hand out another user's library
    photo passes its request (``test_library_share_reads.py``).
    """
    root = serializer.root
    lookup = getattr(root, _LOOKUP_ATTR, None)
    if isinstance(lookup, GrantLookup):
        return lookup
    request = serializer.context.get("request")
    lookup = GrantLookup(getattr(request, "user", None))
    setattr(root, _LOOKUP_ATTR, lookup)
    return lookup


# Field -> (switch, the value a recipient gets without it).
FieldRules = Mapping[str, tuple[Switch, object]]

SUMMARY_FIELDS: FieldRules = {
    "id": (ALWAYS, None),
    "image_hash": (ALWAYS, None),
    "dominantColor": (ALWAYS, None),
    "url": (ALWAYS, None),
    "location": ("location", ""),
    "date": (ALWAYS, None),
    "birthTime": (ALWAYS, None),
    "aspectRatio": (ALWAYS, None),
    "type": (ALWAYS, None),
    "video_length": (ALWAYS, None),
    "is_hdr": (ALWAYS, None),
    "animated_preview": (ALWAYS, None),
    "video_poster": (ALWAYS, None),
    "rating": (NEVER, 0),
    "owner": (ALWAYS, None),
    "exif_gps_lat": ("location", None),
    "exif_gps_lon": ("location", None),
    "removed": (ALWAYS, None),
    "in_trashcan": (ALWAYS, None),
    "archived": (ALWAYS, None),
    "trashed_at": (NEVER, None),
    "stacks": (NEVER, None),
    "has_raw_variant": (NEVER, False),
    # The owner's rotation: without it the photo shows sideways.
    "local_orientation": (ALWAYS, None),
    # How to draw the picture (a 360° photo sphere, #483).
    "projection_type": (ALWAYS, None),
}

_CAMERA_FIELDS = (
    "focal_length",
    "fstop",
    "iso",
    "shutter_speed",
    "lens",
    "camera",
    "focalLength35Equivalent",
    "digitalZoomRatio",
    "subjectDistance",
    "exposure_compensation",
    "flash_fired",
    "metering_mode",
    "white_balance",
)

DETAIL_FIELDS: FieldRules = {
    "id": (ALWAYS, None),
    "exif_gps_lat": ("location", None),
    "exif_gps_lon": ("location", None),
    "exif_timestamp": (ALWAYS, None),
    "exif_timestamp_offset": (ALWAYS, None),
    # Which date rule set the date, and whether the owner set it: edit history.
    "exif_timestamp_source": (NEVER, None),
    "date_set_by_user": (NEVER, False),
    "captions_json": ("captions", {"im2txt": ""}),
    # The search text mixes captions, people, camera, keywords and file paths.
    "search_captions": (NEVER, ""),
    "search_location": ("location", ""),
    "big_thumbnail_url": (ALWAYS, None),
    "square_thumbnail_url": (ALWAYS, None),
    "small_square_thumbnail_url": (ALWAYS, None),
    "geolocation_json": ("location", None),
    "people": ("people", []),
    "image_hash": (ALWAYS, None),
    "image_path": (NEVER, []),
    "rating": (NEVER, 0),
    "hidden": (ALWAYS, None),
    "public": (NEVER, False),
    "removed": (ALWAYS, None),
    "in_trashcan": (ALWAYS, None),
    "archived": (ALWAYS, None),
    "trashed_at": (NEVER, None),
    "shared_to": (NEVER, []),
    "similar_photos": (ALWAYS, None),
    "video": (ALWAYS, None),
    "is_screenshot": (ALWAYS, None),
    "is_document": (ALWAYS, None),
    "category_source": (NEVER, "auto"),
    "owner": (ALWAYS, None),
    "size": (ALWAYS, None),
    "height": (ALWAYS, None),
    "width": (ALWAYS, None),
    **{name: ("camera", None) for name in _CAMERA_FIELDS},
    "gps_altitude": ("location", None),
    "video_length": (ALWAYS, None),
    "video_codec": (ALWAYS, None),
    # A motion photo's video comes out of the original file.
    "embedded_media": ("originals", []),
    "video_playback_type": (ALWAYS, None),
    "file_variants": (NEVER, None),
    "stacks": (NEVER, None),
    # Camera, keywords, title and the edit history in one block.
    "metadata": (NEVER, None),
    "ocr": (NEVER, None),
    "local_orientation": (ALWAYS, None),
    "original_mime_type": (ALWAYS, None),
    "projection_type": (ALWAYS, None),
    "shared_library": (ALWAYS, None),
}


def redact(
    data: MutableMapping[str, object], rules: FieldRules, grant: LibraryGrant
) -> None:
    """Replace in ``data`` every field ``grant`` does not allow, in place.

    A field missing from ``rules`` is hidden: fail closed.
    """
    for name in list(data):
        switch, hidden_value = rules.get(name, (NEVER, None))
        if not grant.allows(switch):
            data[name] = hidden_value
