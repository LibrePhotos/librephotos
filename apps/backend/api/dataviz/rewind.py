"""Rewind: a user's year in photos, the recap the web app opens around Christmas.

Only the user's own photos count, as the timeline shows them (no hidden,
trashed or archived photos), without screenshots and documents, like memories.
A photo belongs to the year of the calendar day the timeline groups it under
(the wall-clock date of ``exif_timestamp``, ``api.timeline``), so no timezone conversion moves a New Year's Eve photo
into the next year. The cost is a handful of grouped queries over one year of
photos; nothing is stored.
"""

import datetime
import uuid
from typing import TypedDict

from django.db.models import Count, Max, Q, QuerySet

from api.dataviz.stats import without_parallel_workers
from api.models import Face, Person, Photo, User
from api.models.place_names import place_name
from api.photos.selection import build_photo_queryset
from api.timeline.days import dates_q, day_q, taken_day

TOP_PEOPLE = 5
TOP_PLACES = 3
# The intro slide's collage: the best photo of each of the busiest days.
COVER_PHOTOS = 6
BUSIEST_DAY_PHOTOS = 8


class RewindDay(TypedDict):
    date: datetime.date
    count: int


class RewindPerson(TypedDict):
    id: int
    name: str
    photo_count: int
    face_url: str | None


class RewindPlace(TypedDict):
    name: str
    photo_count: int


class Rewind(TypedDict):
    year: int
    photo_count: int
    video_count: int
    months: list[int]
    busiest_day: RewindDay | None
    busiest_day_photo_ids: list[uuid.UUID]
    cover_photo_ids: list[uuid.UUID]
    people: list[RewindPerson]
    place_count: int
    country_count: int
    top_places: list[RewindPlace]


def rewind_year(today: datetime.date) -> int:
    """The year a Rewind opened on ``today`` looks back on: in January, the last one."""
    return today.year - 1 if today.month == 1 else today.year


def year_photos(user: User, year: int) -> QuerySet[Photo]:
    """The photos of ``user``'s timeline taken on a day of ``year``."""
    timeline = build_photo_queryset(
        user, {"hide_screenshots": True, "hide_documents": True, "archived": False}
    ).filter(removed=False)
    return timeline.filter(
        dates_q(datetime.date(year, 1, 1), datetime.date(year, 12, 31))
    )


def _day_counts(photos: QuerySet[Photo]) -> dict[datetime.date, int]:
    rows = (
        photos.order_by()
        .annotate(day=taken_day())
        .values_list("day")
        .annotate(total=Count("id", distinct=True))
    )
    return {day: total for day, total in rows if day is not None}


def _best_photo_ids(
    photos: QuerySet[Photo], day: datetime.date, limit: int
) -> list[uuid.UUID]:
    """The photos of ``day`` worth showing: stills first, favourites first, in the order taken."""
    return list(
        photos.filter(day_q(day))
        .order_by("video", "-rating", "exif_timestamp", "image_hash")
        .values_list("id", flat=True)[:limit]
    )


def _people(photos: QuerySet[Photo]) -> list[RewindPerson]:
    """The named people on the most photos of the year."""
    rows = list(
        Face.objects.filter(
            photo__in=photos.values("id"),
            person__kind=Person.KIND_USER,
            deleted=False,
        )
        .order_by()
        .values("person")
        .annotate(photo_count=Count("photo", distinct=True))
        .order_by("-photo_count", "person")[:TOP_PEOPLE]
    )
    persons = Person.objects.select_related("cover_face").in_bulk(
        [row["person"] for row in rows]
    )
    people: list[RewindPerson] = []
    for row in rows:
        person = persons.get(row["person"])
        if person is None:
            continue
        people.append(
            {
                "id": person.id,
                "name": person.name,
                "photo_count": row["photo_count"],
                "face_url": person.cover_face.crop_url if person.cover_face else None,
            }
        )
    return people


def _places(user: User, photos: QuerySet[Photo]) -> tuple[list[RewindPlace], int, int]:
    """The year's towns by photo count, how many there were, and in how many countries."""
    rows = list(
        photos.exclude(town="")
        .order_by()
        .values("town")
        .annotate(photo_count=Count("id", distinct=True), sample=Max("image_hash"))
        .order_by("-photo_count", "town")
    )
    # One photo per town is enough to name its country.
    samples = (
        Photo.objects.owned_by(user)
        .filter(image_hash__in=[row["sample"] for row in rows])
        .values_list("geolocation_json", flat=True)
    )
    countries = {name for geo in samples if (name := place_name(geo, "country"))}
    top: list[RewindPlace] = [
        {"name": row["town"], "photo_count": row["photo_count"]}
        for row in rows[:TOP_PLACES]
    ]
    return top, len(rows), len(countries)


@without_parallel_workers()
def build_rewind(user: User, year: int) -> Rewind:
    photos = year_photos(user, year)
    counts = photos.aggregate(
        photo_count=Count("id", distinct=True, filter=Q(video=False)),
        video_count=Count("id", distinct=True, filter=Q(video=True)),
    )
    days = _day_counts(photos)
    months = [0] * 12
    for day, total in days.items():
        months[day.month - 1] += total

    # Most photos first; the earlier day wins a tie.
    ranked = sorted(days.items(), key=lambda item: (-item[1], item[0]))
    busiest: RewindDay | None = (
        {"date": ranked[0][0], "count": ranked[0][1]} if ranked else None
    )
    busiest_ids = (
        _best_photo_ids(photos, ranked[0][0], BUSIEST_DAY_PHOTOS) if ranked else []
    )
    cover_ids = [
        photo_id
        for day, _ in ranked[:COVER_PHOTOS]
        for photo_id in _best_photo_ids(photos, day, 1)
    ]
    top_places, place_count, country_count = _places(user, photos)
    return {
        "year": year,
        "photo_count": counts["photo_count"],
        "video_count": counts["video_count"],
        "months": months,
        "busiest_day": busiest,
        "busiest_day_photo_ids": busiest_ids,
        "cover_photo_ids": cover_ids,
        "people": _people(photos),
        "place_count": place_count,
        "country_count": country_count,
        "top_places": top_places,
    }
