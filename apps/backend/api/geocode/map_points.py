"""The Places map as photos rather than place names (#343).

The map used to draw one pin per place name at the centre of that place, so a
photo showed up once for its street, once for its town and once for its
county, and a cluster counted place names. It now draws the photos at their
own positions, and the place grid under it lists the places with a photo
inside the map's view.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TypedDict

from django.db.models import Count, Exists, OuterRef, Q, QuerySet
from django.db.models.functions import Round

from api.geocode.photo_location import HAS_POSITION
from api.models import AlbumPlace, Photo

# Decimal places a map point keeps: about a metre. Photos taken that close
# together are one point that counts them, which keeps the answer small for a
# burst or a day at home.
POINT_DECIMALS = 5


@dataclass(frozen=True)
class MapBounds:
    """The part of the world a map shows, in degrees.

    ``west`` greater than ``east`` is a view across the antimeridian (the
    180th meridian), which takes the longitudes from ``west`` up to 180 and
    from -180 up to ``east``.
    """

    south: float
    west: float
    north: float
    east: float


class MapPoints(TypedDict):
    """``GET /api/photos/map-points/``."""

    # [latitude, longitude, photos taken there]
    points: list[tuple[float, float, int]]
    photo_count: int


def in_bounds_q(bounds: MapBounds, prefix: str = "") -> Q:
    """Photos whose position lies inside ``bounds``, edges included.

    ``prefix`` reaches the photo through a relation (``"photos__"`` on a
    place album).
    """
    lat = f"{prefix}exif_gps_lat"
    lon = f"{prefix}exif_gps_lon"
    latitude = Q(**{f"{lat}__gte": bounds.south, f"{lat}__lte": bounds.north})
    if bounds.west <= bounds.east:
        longitude = Q(**{f"{lon}__gte": bounds.west, f"{lon}__lte": bounds.east})
    else:
        longitude = Q(**{f"{lon}__gte": bounds.west}) | Q(
            **{f"{lon}__lte": bounds.east}
        )
    return latitude & longitude


def map_points(photos: QuerySet[Photo]) -> MapPoints:
    """One point per spot where ``photos`` were taken, with how many.

    Positions are rounded to ``POINT_DECIMALS`` and counted by the database,
    so a library of 100,000 photos does not cross into Python row by row.
    The (0, 0) a camera writes without a fix is left out, as everywhere else
    (``usable_coordinates``).
    """
    rows = (
        photos.filter(HAS_POSITION)
        .exclude(exif_gps_lat=0, exif_gps_lon=0)
        .order_by()
        .values(
            lat=Round("exif_gps_lat", POINT_DECIMALS),
            lon=Round("exif_gps_lon", POINT_DECIMALS),
        )
        .annotate(n=Count("pk"))
        .values_list("lat", "lon", "n")
    )
    points = sorted(rows)
    return {"points": points, "photo_count": sum(n for _, _, n in points)}


def place_albums_in_bounds(
    albums: QuerySet[AlbumPlace], photos: QuerySet[Photo], bounds: MapBounds
) -> list[int]:
    """The ids of ``albums`` holding one of ``photos`` inside ``bounds``.

    A country stays in the list while one of its photos is in view, however
    far its centre is. Two plans, by what the view holds: the albums of the
    photos inside it while they are fewer than the photos outside, which
    reads their links only; otherwise an ``EXISTS`` per album, which stops at
    an album's first photo in view, so a wide view does not read every link
    of the library either. On 100,000 photos (SQLite) both stay under a
    second where one plan alone took up to six.
    """
    inside = photos.filter(in_bounds_q(bounds))
    if inside.count() * 2 <= photos.count():
        links = AlbumPlace.photos.through.objects.filter(photo__in=inside.values("pk"))
        ids = set(links.values_list("albumplace_id", flat=True))
        return sorted(ids.intersection(albums.values_list("id", flat=True)))
    with_one = Exists(inside.filter(albumplace=OuterRef("pk")))
    return list(albums.filter(with_one).order_by("id").values_list("id", flat=True))
