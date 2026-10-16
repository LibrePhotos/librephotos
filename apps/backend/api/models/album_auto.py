import logging
from collections import Counter
from collections.abc import Iterable
from datetime import datetime
from typing import TypedDict

from django.db import models

from api.models.person import Person
from api.models.photo import Photo
from api.models.place_names import short_place_name
from api.models.scopes import SharedOwnedQuerySet
from api.models.user import User, get_deleted_user

logger = logging.getLogger(__name__)

# Upper hour bound (exclusive) -> the time-of-day key stored in ``title_parts``.
TIME_OF_DAY = (
    (5, "early_morning"),
    (12, "morning"),
    (18, "afternoon"),
    (25, "evening"),
)
# Time-of-day key -> its words in the English ``title``.
TIME_OF_DAY_LABELS = {
    "early_morning": "Early Morning",
    "morning": "Morning",
    "afternoon": "Afternoon",
    "evening": "Evening",
}
WEEKEND = [5, 6]
# ISO weekday (Monday is 1) -> its name in an album title.
WEEKDAYS = {
    1: "Monday",
    2: "Tuesday",
    3: "Wednesday",
    4: "Thursday",
    5: "Friday",
    6: "Saturday",
    7: "Sunday",
}
# A span of at least this many days names the event by its length ("3 days").
MULTI_DAY_SPAN = 3


class TitleParts(TypedDict):
    """What an event title is made of, so each client can word it in its language (#2235).

    ``title`` is these parts in English (``_english_title``); the web app formats
    them with its translations. Weekday and time of day are the first photo's
    wall clock, stored here so no client recomputes them in its own time zone.
    """

    # ISO weekday (Monday is 1) of the first photo.
    weekday: int | None
    # A key of TIME_OF_DAY, or None at midnight.
    time_of_day: str | None
    # Whole days between the first and the last photo.
    span_days: int
    # The first and the last photo fall on different weekend days.
    weekend: bool
    # At most the two most frequent named people.
    people: list[str]
    # At most the two most frequent towns of the photos (``short_place_name``).
    places: list[str]
    # The album's grouping date (YYYY-MM-DD), for "Album from <date>".
    date: str


def _time_of_day(hour: int) -> str | None:
    if hour <= 0:
        return None
    for until, key in TIME_OF_DAY:
        if hour < until:
            return key
    return None


def _collect_photo_details(
    photos: Iterable[Photo],
) -> tuple[list[str], list[str], list[datetime]]:
    places: list[str] = []
    people: list[str] = []
    timestamps: list[datetime] = []
    for photo in photos:
        place = short_place_name(photo.geolocation_json)
        if place:
            places.append(place)
        timestamp = photo.exif_timestamp
        # Only called from _title_parts(), whose caller turns any exception into
        # the fallback title. A photo without a time always ended there: min()
        # and the span arithmetic raise on None.
        assert timestamp is not None, "photo has no exif_timestamp"
        timestamps.append(timestamp)
        for face in photo.faces.all():
            # Most faces in a library are unnamed, and a deleted one should not
            # name an album. Dereferencing face.person.name for those raised
            # AttributeError, and _generate_title() catches every exception --
            # so a single unnamed face silently cost the album its whole title.
            if face.deleted or face.person is None:
                continue
            people.append(face.person.name)
    return places, people, timestamps


def _top_places(places: list[str]) -> list[str]:
    return [place for place, _ in Counter(places).most_common(2)]


def _top_people(people: list[str]) -> list[str]:
    # The two most frequent names first, then the placeholders are dropped, so
    # "unknown" being one of the two leaves a single name.
    unknown = ("unknown", Person.UNKNOWN_PERSON_NAME.lower())
    return [
        name
        for name, _ in Counter(people).most_common(2)
        if name.lower() not in unknown
    ]


def _is_weekend(first: datetime, last: datetime) -> bool:
    return (
        last.weekday() in WEEKEND
        and first.weekday() in WEEKEND
        and last.weekday() != first.weekday()
    )


def _fallback_parts(album_timestamp: datetime) -> TitleParts:
    """Parts that say nothing but the date: the title reads "Album from <date>"."""
    return TitleParts(
        weekday=None,
        time_of_day=None,
        span_days=0,
        weekend=False,
        people=[],
        places=[],
        date=album_timestamp.strftime("%Y-%m-%d"),
    )


def _title_parts(photos: Iterable[Photo], album_timestamp: datetime) -> TitleParts:
    """The parts of the title of an event of ``photos`` anchored at ``album_timestamp``.

    Reads the photos (and their faces) and writes nothing. Raises on a photo
    without ``exif_timestamp``; ``AlbumAuto._generate_title`` falls back then.
    """
    places, people, timestamps = _collect_photo_details(photos)
    parts = _fallback_parts(album_timestamp)
    # ``album_timestamp`` is the grouping key generate_event_albums anchors the
    # album on: the first photo's time minus 11h59, so that photos shortly
    # before it still match the album. Read the weekday and time of day off the
    # first photo itself, or every title lands about half a day early ("Friday
    # Evening" for a Saturday morning at the beach). The key only stands in when
    # the album is empty.
    anchor = min(timestamps) if timestamps else album_timestamp
    parts["weekday"] = anchor.isoweekday()
    parts["time_of_day"] = _time_of_day(anchor.hour)
    if timestamps:
        first, last = min(timestamps), max(timestamps)
        parts["span_days"] = (last - first).days
        parts["weekend"] = _is_weekend(first, last)
    parts["people"] = _top_people(people)
    parts["places"] = _top_places(places)
    return parts


def _english_when(parts: TitleParts) -> str:
    if parts["weekend"]:
        return "Weekend"
    if parts["span_days"] >= MULTI_DAY_SPAN:
        return f"{parts['span_days']} days"
    weekday = WEEKDAYS[parts["weekday"]] if parts["weekday"] else ""
    time = TIME_OF_DAY_LABELS[parts["time_of_day"]] if parts["time_of_day"] else ""
    return " ".join(part for part in [weekday, time] if part)


def _english_title(parts: TitleParts) -> str:
    """``parts`` worded as the English title stored in ``AlbumAuto.title``."""
    people = "with " + " and ".join(parts["people"]) if parts["people"] else ""
    places = "in " + " and ".join(parts["places"]) if parts["places"] else ""
    # Skip the empty parts, or "Tuesday Afternoon  in Paris" gets two spaces.
    title = " ".join(part for part in [_english_when(parts), people, places] if part)
    return title or f"Album from {parts['date']}"


class AlbumAutoQuerySet(SharedOwnedQuerySet["AlbumAuto"]):
    """Scoped to its owner through ``owner``."""


class AlbumAuto(models.Model):
    title = models.CharField(
        blank=False, null=False, max_length=512, default="Untitled Album"
    )
    # The parts ``title`` is worded from (a TitleParts), for clients that word it
    # in the user's language. None until the next event run or title regeneration.
    title_parts = models.JSONField(blank=True, null=True)
    timestamp = models.DateTimeField(db_index=True)
    created_on = models.DateTimeField(auto_now=False, db_index=True)
    gps_lat = models.FloatField(blank=True, null=True)
    gps_lon = models.FloatField(blank=True, null=True)
    photos = models.ManyToManyField(Photo)
    favorited = models.BooleanField(default=False, db_index=True)
    owner = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), default=None
    )
    # The cover the owner picked (#429), one of the event's photos; None shows
    # the first visible photo. Event generation only adds photos to an event,
    # so a regeneration keeps it (api/albums/auto_albums.py).
    cover_photo = models.ForeignKey(
        Photo,
        related_name="album_auto_cover",
        on_delete=models.SET_NULL,
        blank=True,
        null=True,
    )

    shared_to = models.ManyToManyField(User, related_name="album_auto_shared_to")
    # Delta-sync ordering key (mobile v2, doc 04).
    last_modified = models.DateTimeField(auto_now=True, db_index=True)

    objects = AlbumAutoQuerySet.as_manager()

    class Meta:
        unique_together = ("timestamp", "owner")

    def _generate_title(self) -> None:
        """Recompute ``title_parts`` and the English ``title`` from the photos, and save."""
        try:
            parts = _title_parts(self.photos.all(), self.timestamp)
        except Exception as e:
            logger.exception(e)
            # Set a fallback title if something goes wrong
            parts = _fallback_parts(self.timestamp)
        self.title_parts = parts
        self.title = _english_title(parts)
        self.save()

    def __str__(self) -> str:
        return f"{self.id}: {self.title}"
