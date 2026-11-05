"""Date-based memories: what a user photographed on this day in earlier years.

Issue #844 asks for tiles a user can explore, showing the images they took a
year, two years, ... ago.

A photo's day is the calendar day the timeline groups it under
(``api.timeline``): the wall-clock date of ``exif_timestamp``, so a memory
covers exactly the days the timeline shows and no timezone conversion can shift
it onto the neighbouring day. Each window is a range of the ``exif_timestamp``
index, so the cost follows the photos in the windows, not the library.

An exact "on this day" match is empty on most days for most libraries, so the
lookup covers a small window of days around the anniversary, and falls back to
"this month, N years ago" when the window finds nothing at all.
"""

import datetime
import uuid
from typing import TypedDict
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db.models import Count, Min, Q, QuerySet
from django.utils import timezone
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.drf.params import parse_query
from api.drf.request_user import request_user
from api.models import Photo, User
from api.photos.selection import build_photo_queryset
from api.serializers.memories import (
    TYPE_MONTH_YEARS_AGO,
    TYPE_YEARS_AGO,
    MemoriesQuery,
    MemoriesSerializer,
)
from api.serializers.photos import PhotoSummarySerializer
from api.timeline.days import dates_q, taken_day
from api.timeline.rows import first_towns
from api.views.albums import _with_photo_summary_relations

# (years_ago, anchor, start, end): one candidate window of days for a memory.
Window = tuple[int, datetime.date, datetime.date, datetime.date]


class _PlannedMemory(TypedDict):
    years_ago: int
    anchor: datetime.date
    days: list[datetime.date]
    count: int
    photo_ids: list[uuid.UUID]


def today_for_user(user: User) -> datetime.date:
    """Today as the user's own wall clock sees it.

    A photo's day is a local calendar day, so the anniversary has to be
    taken from the user's calendar too -- otherwise memories flip over at the
    server's midnight instead of theirs.
    """
    tzinfo: datetime.tzinfo
    try:
        tzinfo = ZoneInfo(user.default_timezone or "UTC")
    except ZoneInfoNotFoundError, ValueError:
        tzinfo = datetime.UTC
    return timezone.now().astimezone(tzinfo).date()


def anniversary(year: int, month: int, day: int) -> datetime.date:
    """The same month/day in ``year``, pulling 29 February back to the 28th."""
    try:
        return datetime.date(year, month, day)
    except ValueError:
        return datetime.date(year, month, day - 1)


def day_windows(
    reference: datetime.date, first_year: int, window_days: int
) -> list[Window]:
    """One window of days per year before ``reference``, nearest year first.

    Each entry is ``(years_ago, anniversary, start, end)``. The current year is
    left out: photos from this year's anniversary are still in the timeline, and
    a memory of them would not be a memory yet.
    """
    windows = []
    for year in range(first_year, reference.year):
        anchor = anniversary(year, reference.month, reference.day)
        windows.append(
            (
                reference.year - year,
                anchor,
                anchor - datetime.timedelta(days=window_days),
                anchor + datetime.timedelta(days=window_days),
            )
        )
    windows.reverse()
    return windows


def month_windows(reference: datetime.date, first_year: int) -> list[Window]:
    """One window per year covering the whole of ``reference``'s month.

    The fallback for libraries too sparse to have anything on the anniversary
    itself: better a tile for "August 2019" than an empty page.
    """
    windows = []
    for year in range(first_year, reference.year):
        start = datetime.date(year, reference.month, 1)
        if reference.month == 12:
            end = datetime.date(year, 12, 31)
        else:
            end = datetime.date(year, reference.month + 1, 1) - datetime.timedelta(
                days=1
            )
        windows.append((reference.year - year, start, start, end))
    windows.reverse()
    return windows


def pick_cover(photos: list[Photo]) -> Photo:
    """The photo that best represents a memory.

    Favourites (which are ratings, see ``User.favorite_min_rating``) win, stills
    beat videos because a video makes a poor tile, and the earliest photo of the
    day breaks the tie.
    """
    return min(photos, key=lambda photo: (photo.video, -(photo.rating or 0)))


def memory_candidates(user: User) -> QuerySet[Photo]:
    """Photos eligible to appear in a memory.

    ``build_photo_queryset`` gives the same set the timeline shows -- the user's
    own photos, not hidden, not in the trash, thumbnailed, and only the primary
    photo of a stack so a RAW/JPEG pair is not shown twice. Screenshots and
    documents are dropped on top of that: they are photos the user took, but a
    screenshot from four years ago is not a memory of anything. Archived
    photos are left out like on the timeline (#545).
    """
    candidates: QuerySet[Photo] = build_photo_queryset(
        user, {"hide_screenshots": True, "hide_documents": True, "archived": False}
    ).filter(removed=False)
    return candidates


class MemoriesView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        parameters=[MemoriesQuery],
        responses=MemoriesSerializer,
        description=(
            "Memories for a given day: one entry per earlier year that has "
            "photos around the same date, nearest year first. Titles are left "
            "to the client, which has the translations: an entry carries its "
            "``type``, ``years_ago`` and dates instead of a sentence."
        ),
    )
    def get(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        params = parse_query(request, MemoriesQuery)
        reference = params.get("date") or today_for_user(user)
        window_days = params["window"]
        fallback = params["fallback"]
        size = params["size"]

        first_taken = memory_candidates(user).aggregate(Min("exif_timestamp"))[
            "exif_timestamp__min"
        ]
        first_date = first_taken.date() if first_taken is not None else None

        results: list[dict[str, object]] = []
        if first_date is not None:
            results = self.memories(
                user,
                day_windows(reference, first_date.year, window_days),
                size,
                TYPE_YEARS_AGO,
            )
            if not results and fallback:
                results = self.memories(
                    user,
                    month_windows(reference, first_date.year),
                    size,
                    TYPE_MONTH_YEARS_AGO,
                )

        return Response(
            {
                "date": reference.isoformat(),
                "window_days": window_days,
                "results": results,
            }
        )

    def memories(
        self, user: User, windows: list[Window], size: int, memory_type: str
    ) -> list[dict[str, object]]:
        """Build one memory per window that has any photos in it."""
        if not windows:
            return []
        context = {"request": self.request}

        in_windows = Q()
        for _, _, start, end in windows:
            in_windows |= dates_q(start, end)
        candidates = memory_candidates(user).filter(in_windows)

        # How big each candidate day is, grouped in the database rather than
        # counted in Python: a day of 2000 burst frames costs the same here as a
        # day of two.
        counts: dict[datetime.date, int] = dict(
            candidates.annotate(day=taken_day())
            .values_list("day")
            .annotate(total=Count("id", distinct=True))
            .order_by()
        )
        if not counts:
            return []
        places = first_towns(candidates)

        planned: list[_PlannedMemory] = []
        for years_ago, anchor, start, end in windows:
            days_in_window = sorted(
                day for day, total in counts.items() if start <= day <= end and total
            )
            if not days_in_window:
                continue

            # Chronological, so that playing a memory as a slideshow replays the
            # days in the order they happened. Only the first ``size`` ids are
            # read; the rest of a very large day never leaves the database. The
            # tie-break is ``image_hash`` rather than the file path the album
            # endpoints use, because it lives on the photo row and saves this
            # query -- which runs once per year -- a join.
            photo_ids = list(
                candidates.filter(dates_q(start, end))
                .order_by("exif_timestamp", "image_hash")
                .values_list("id", flat=True)[:size]
            )
            planned.append(
                {
                    "years_ago": years_ago,
                    "anchor": anchor,
                    "days": days_in_window,
                    "count": sum(counts[day] for day in days_in_window),
                    "photo_ids": photo_ids,
                }
            )

        if not planned:
            return []

        wanted = [photo_id for memory in planned for photo_id in memory["photo_ids"]]
        photos = {
            photo.id: photo
            for photo in _with_photo_summary_relations(
                Photo.objects.filter(id__in=wanted)
            )
        }

        results: list[dict[str, object]] = []
        for memory in planned:
            items = [
                photos[photo_id]
                for photo_id in memory["photo_ids"]
                if photo_id in photos
            ]
            if not items:
                continue
            days_in_window = memory["days"]
            # The day nearest the anniversary is the one worth naming; the span
            # is reported separately for a client that wants to show it.
            representative = min(
                days_in_window, key=lambda day: (abs(day - memory["anchor"]), day)
            )
            year = memory["anchor"].year
            results.append(
                {
                    "id": f"{memory_type}-{year}",
                    "type": memory_type,
                    "years_ago": memory["years_ago"],
                    "year": year,
                    "date": representative.isoformat(),
                    "start_date": days_in_window[0].isoformat(),
                    "end_date": days_in_window[-1].isoformat(),
                    "location": places.get(representative)
                    or next(
                        (places[day] for day in days_in_window if day in places), ""
                    ),
                    "numberOfItems": memory["count"],
                    "cover": PhotoSummarySerializer(
                        pick_cover(items), context=context
                    ).data,
                    "items": PhotoSummarySerializer(
                        items, many=True, context=context
                    ).data,
                }
            )
        return results
