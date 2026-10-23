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

Public pages follow the same tables (``public_grant``): a photo the owner made
public, put in an album with a public link or shared by a photo link is shown
to its visitors as the owner's public sharing switches allow, with dates as a
switch of their own and the original file only when every switch is on.
"""

from __future__ import annotations

from collections.abc import Mapping, MutableMapping
from dataclasses import dataclass, fields
from typing import Final, Literal

from django.contrib.auth.models import AnonymousUser
from django.db.models import QuerySet
from rest_framework.serializers import BaseSerializer

from api.models import LibraryShare, User
from api.models.user import public_sharing_settings

Switch = Literal[
    "always",
    "never",
    "location",
    "people",
    "camera",
    "captions",
    "originals",
    "timestamps",
    "users",
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
    # When the photo was taken: always shared with users; on public pages
    # only with the owner's "share_timestamps" switch.
    timestamps: bool = True
    # A public page's visitor rather than a user something was shared with:
    # the "users" fields (how the owner files the photo) are not for them.
    visitor: bool = False

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
        if switch == "users":
            return not self.visitor
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


class UnknownViewerLookup(GrantLookup):
    """A serializer without a request cannot tell whose eyes a photo is for:
    every photo is shown as to a recipient with every switch off."""

    def __init__(self) -> None:
        super().__init__(None)

    def for_owner(self, owner_id: int | None) -> LibraryGrant | None:
        return LibraryGrant()


_LOOKUP_ATTR = "_library_grant_lookup"


def lookup_for(serializer: BaseSerializer) -> GrantLookup:
    """The ``GrantLookup`` of the user ``serializer``'s request is for.

    Kept on the root serializer, which a list serializer's child shares, so a
    page of photos costs one query. Without a request the viewer is unknown,
    so it fails closed: every photo is redacted as for a recipient with every
    switch off (``UnknownViewerLookup``). Every view passes its request.
    """
    root = serializer.root
    lookup = getattr(root, _LOOKUP_ATTR, None)
    if isinstance(lookup, GrantLookup):
        return lookup
    request = serializer.context.get("request")
    lookup = (
        UnknownViewerLookup()
        if request is None
        else GrantLookup(getattr(request, "user", None))
    )
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
    "date": ("timestamps", ""),
    "birthTime": ("timestamps", ""),
    "aspectRatio": (ALWAYS, None),
    "type": (ALWAYS, None),
    "video_length": (ALWAYS, None),
    "is_hdr": (ALWAYS, None),
    "animated_preview": (ALWAYS, None),
    "video_poster": (ALWAYS, None),
    # When a person is first seen in a video: who is on it (#2762).
    "person_video_time": ("people", None),
    "rating": (NEVER, 0),
    "owner": (ALWAYS, None),
    "exif_gps_lat": ("location", None),
    "exif_gps_lon": ("location", None),
    "removed": (ALWAYS, None),
    "in_trashcan": (ALWAYS, None),
    "archived": ("users", False),
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
    "exif_timestamp": ("timestamps", None),
    # The UTC offset names the photo's time zone: a location.
    "exif_timestamp_offset": ("location", None),
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
    "archived": ("users", False),
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
    # Copyright, creator and license (#425): the owner's statement about
    # reuse, meant for whoever sees the photo.
    "rights": (ALWAYS, None),
}


# The caption the captioning model wrote. Its prompt may have named the person
# on the photo and the place (``PhotoCaption.caption_prompt``), so it is shown
# only where the people and the location are too.
GENERATED_CAPTION: Final = "im2txt"


def shown_captions(captions: object, grant: LibraryGrant) -> object:
    """``captions_json`` as ``grant`` shows it, the captions switch aside."""
    if grant.people and grant.location:
        return captions
    if isinstance(captions, Mapping) and captions.get(GENERATED_CAPTION):
        return {**captions, GENERATED_CAPTION: ""}
    return captions


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
    if "captions_json" in data:
        data["captions_json"] = shown_captions(data["captions_json"], grant)


# --- Public pages -----------------------------------------------------------

# Grant attribute -> the owner's public sharing switch.
PUBLIC_SWITCHES: Final = {
    "location": "share_location",
    "people": "share_faces",
    "camera": "share_camera_info",
    "captions": "share_captions",
    "timestamps": "share_timestamps",
}

# The context key a view sets to the grant of the public page it renders (an
# album link's own switches); without it the owner's defaults decide.
PUBLIC_GRANT: Final = "public_grant"


def public_grant(settings: Mapping[str, object] | None) -> LibraryGrant:
    """What a visitor of a public page sees, from its sharing settings
    (``share_location`` and the others).

    A switch is on only when it is ``True``: missing or unreadable is off.
    The original file carries every kind of metadata at once, so it is
    handed out only when every switch is on.
    """
    values: Mapping[str, object] = settings if isinstance(settings, Mapping) else {}
    switches = {name: values.get(key) is True for name, key in PUBLIC_SWITCHES.items()}
    return LibraryGrant(originals=all(switches.values()), visitor=True, **switches)


def owner_public_grant(owner_id: int | None) -> LibraryGrant:
    """``public_grant`` of the owner's own defaults (a public photo, a photo link)."""
    owner = (
        User.objects.filter(pk=owner_id).only("public_sharing_defaults").first()
        if owner_id is not None
        else None
    )
    return public_grant(public_sharing_settings(owner))


def either(a: LibraryGrant, b: LibraryGrant) -> LibraryGrant:
    """What two ways to a photo (two albums, two links) show between them:
    each field either allows, and a user's way beats a visitor's."""
    shown = {f.name: getattr(a, f.name) or getattr(b, f.name) for f in fields(a)}
    shown["visitor"] = a.visitor and b.visitor
    return LibraryGrant(**shown)


class PublicLookup(GrantLookup):
    """Every photo as a visitor of a public page sees it, whoever asks.

    ``grant`` is the page's own (an album link); without it each owner's
    public sharing defaults decide, one query per owner.
    """

    def __init__(self, grant: LibraryGrant | None = None) -> None:
        super().__init__(None)
        self._grant = grant
        self._owners: dict[int | None, LibraryGrant] = {}

    def for_owner(self, owner_id: int | None) -> LibraryGrant:
        if self._grant is not None:
            return self._grant
        if owner_id not in self._owners:
            self._owners[owner_id] = owner_public_grant(owner_id)
        return self._owners[owner_id]


_PUBLIC_LOOKUP_ATTR = "_public_grant_lookup"


def _public_page_lookup(serializer: BaseSerializer) -> PublicLookup | None:
    fixed = serializer.context.get(PUBLIC_GRANT)
    if isinstance(fixed, LibraryGrant):
        return PublicLookup(fixed)
    if serializer.context.get("public") is True:
        return PublicLookup()
    request = serializer.context.get("request")
    if request is not None and _account(getattr(request, "user", None)) is None:
        # Nobody signed in reads only what public pages show.
        return PublicLookup()
    return None


def public_lookup_for(serializer: BaseSerializer) -> PublicLookup | None:
    """The ``PublicLookup`` when ``serializer`` renders a public page
    (``PUBLIC_GRANT`` or ``public`` in its context) or answers a visitor who
    is not signed in; None otherwise. Kept on the root like ``lookup_for``.
    """
    root = serializer.root
    if hasattr(root, _PUBLIC_LOOKUP_ATTR):
        cached = getattr(root, _PUBLIC_LOOKUP_ATTR)
        return cached if isinstance(cached, PublicLookup) else None
    lookup = _public_page_lookup(serializer)
    setattr(root, _PUBLIC_LOOKUP_ATTR, lookup)
    return lookup


def viewer_grant(
    serializer: BaseSerializer, owner_id: int | None
) -> LibraryGrant | None:
    """The grant a photo of ``owner_id`` is redacted by for ``serializer``'s
    reader: a public page's, else a library share's (``lookup_for``)."""
    public = public_lookup_for(serializer)
    if public is not None:
        return public.for_owner(owner_id)
    return lookup_for(serializer).for_owner(owner_id)


# ``PublicPhotoDetailSerializer``: a photo behind a photo link or in a public
# album. The search text mixes captions, people, keywords and file paths.
PUBLIC_DETAIL_FIELDS: FieldRules = {
    "image_hash": (ALWAYS, None),
    "video": (ALWAYS, None),
    "square_thumbnail_url": (ALWAYS, None),
    "big_thumbnail_url": (ALWAYS, None),
    "small_square_thumbnail_url": (ALWAYS, None),
    "exif_timestamp": ("timestamps", None),
    "exif_gps_lat": ("location", None),
    "exif_gps_lon": ("location", None),
    "geolocation_json": ("location", None),
    "search_location": ("location", ""),
    "camera": ("camera", None),
    "lens": ("camera", None),
    "focal_length": ("camera", None),
    "fstop": ("camera", None),
    "iso": ("camera", None),
    "shutter_speed": ("camera", None),
    # 0, not null: the public client rejects a null size.
    "width": ("camera", 0),
    "height": ("camera", 0),
    "search_captions": (NEVER, ""),
    "captions_json": ("captions", {"im2txt": ""}),
    "people": ("people", []),
    "rights": (ALWAYS, None),
}

# ``PhotoSuperSimpleSerializer``: the sample photos on a public user's card.
SAMPLE_FIELDS: FieldRules = {
    "image_hash": (ALWAYS, None),
    "rating": (NEVER, 0),
    "hidden": (ALWAYS, None),
    "exif_timestamp": ("timestamps", None),
    "public": (ALWAYS, None),
    "video": (ALWAYS, None),
}
