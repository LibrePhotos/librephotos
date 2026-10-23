"""What a place being drawn would hold (#1365): the editor's live count."""

from __future__ import annotations

from typing import TypedDict

from django.db.models import F

from api.geocode.map_points import in_bounds_q
from api.models import Photo, User
from api.models.user_place import UserPlace
from api.places.geometry import circle_bounds, distance_m
from api.places.membership import contains

# Thumbnails the editor shows next to the count.
PREVIEW_COVERS = 4


class PreviewCover(TypedDict):
    image_hash: str
    video: bool


class PreviewOverlap(TypedDict):
    """Another of the owner's places that shares photos with the circle."""

    id: int
    name: str
    photo_count: int
    # That place is the smaller one, so the shared photos show it.
    smaller: bool


class PlacePreview(TypedDict):
    photo_count: int
    cover_photos: list[PreviewCover]
    overlaps: list[PreviewOverlap]


def preview_place(
    owner: User, lat: float, lon: float, radius_m: int, exclude_id: int | None = None
) -> PlacePreview:
    """How many of ``owner``'s visible photos were taken inside the circle,
    the newest few, and the owner's other places that share some of them
    (``exclude_id``: the place being edited)."""
    box = circle_bounds(lat, lon, radius_m)
    rows = (
        Photo.visible.owned_by(owner)
        .filter(in_bounds_q(box))
        .order_by(F("exif_timestamp").desc(nulls_last=True), "pk")
        .values_list("image_hash", "video", "exif_gps_lat", "exif_gps_lon")
    )
    inside = [
        (image_hash, video, plat, plon)
        for image_hash, video, plat, plon in rows
        if plat is not None
        and plon is not None
        and distance_m(lat, lon, plat, plon) <= radius_m
    ]
    others = UserPlace.objects.owned_by(owner)
    if exclude_id is not None:
        others = others.exclude(pk=exclude_id)
    overlaps: list[PreviewOverlap] = []
    for place in others.order_by("name", "pk"):
        shared = sum(1 for _, _, plat, plon in inside if contains(place, plat, plon))
        if shared:
            overlaps.append(
                {
                    "id": place.pk,
                    "name": place.name,
                    "photo_count": shared,
                    "smaller": place.radius_m < radius_m,
                }
            )
    return {
        "photo_count": len(inside),
        "cover_photos": [
            {"image_hash": image_hash, "video": video}
            for image_hash, video, _, _ in inside[:PREVIEW_COVERS]
        ],
        "overlaps": overlaps,
    }
