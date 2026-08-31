"""Date-based memories: what a user photographed on this day in earlier years.

Issue #844 asks for tiles a user can explore, showing the images they took a
year, two years, ... ago.

The days come from :class:`~api.models.album_date.AlbumDate` rather than from
``Photo.exif_timestamp`` directly, for two reasons. ``AlbumDate.date`` is the
plain calendar day the timeline groups a photo under, so a memory covers exactly
the days the timeline shows and no timezone conversion can shift it onto the
neighbouring day. And ``AlbumDate`` holds one row per (day, owner), which makes
the cost of this endpoint proportional to the number of years a library spans
rather than to the number of photos in it -- a 200k-photo library is looked up
through the same handful of indexed date ranges as a 200-photo one.

An exact "on this day" match is empty on most days for most libraries, so the
lookup covers a small window of days around the anniversary, and falls back to
"this month, N years ago" when the window finds nothing at all.
"""

import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db.models import Count, Min, Q
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.models import AlbumDate, Photo
from api.serializers.photos import PhotoSummarySerializer
from api.views.albums import _with_photo_summary_relations
from api.views.photo_filters import build_photo_queryset

# Days either side of the anniversary that still count as the same memory. Three
# days keeps a weekend trip together without pulling in an unrelated week.
DEFAULT_WINDOW_DAYS = 3
MAX_WINDOW_DAYS = 30

# Items returned per memory. The whole page is a single request, so this bounds
# the work: a memory reports its true size in ``numberOfItems`` and returns at
# most this many photos to show and to play as a slideshow.
DEFAULT_ITEMS_PER_MEMORY = 30
MAX_ITEMS_PER_MEMORY = 200

# ``type`` values in the response. Only date-based memories exist so far; the
# field is there so that place- or person-based ones can be added without the
# frontend having to guess what a memory is about.
TYPE_YEARS_AGO = "years_ago"
TYPE_MONTH_YEARS_AGO = "month_years_ago"


def parse_date(value):
    """Return ``value`` (an ISO ``YYYY-MM-DD`` string) as a date, else None."""
    try:
        return datetime.date.fromisoformat(value)
    except (TypeError, ValueError):
        return None


def parse_flag(value, default):
    """Read a query-parameter flag that has a meaningful default of its own."""
    if value is None:
        return default
    return value.strip().lower() not in ("false", "0", "f", "no", "off")


def clamp_int(value, default, minimum, maximum):
    """Return ``value`` as an int inside [minimum, maximum], else ``default``."""
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, number))


def today_for_user(user):
    """Today as the user's own wall clock sees it.

    ``AlbumDate.date`` is a local calendar day, so the anniversary has to be
    taken from the user's calendar too -- otherwise memories flip over at the
    server's midnight instead of theirs.
    """
    try:
        tzinfo = ZoneInfo(user.default_timezone or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        tzinfo = datetime.timezone.utc
    return timezone.now().astimezone(tzinfo).date()


def anniversary(year, month, day):
    """The same month/day in ``year``, pulling 29 February back to the 28th."""
    try:
        return datetime.date(year, month, day)
    except ValueError:
        return datetime.date(year, month, day - 1)


def day_windows(reference, first_year, window_days):
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


def month_windows(reference, first_year):
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


def album_date_place(location):
    """The place name stored on an ``AlbumDate``, or "" when there is none.

    ``AlbumDate.location`` is written by the geolocation job and is only ever
    read for display, so anything unexpected in it degrades to no place rather
    than to an error.
    """
    if not isinstance(location, dict):
        return ""
    places = location.get("places")
    if isinstance(places, list) and places and isinstance(places[0], str):
        return places[0]
    return ""


def pick_cover(photos):
    """The photo that best represents a memory.

    Favourites (which are ratings, see ``User.favorite_min_rating``) win, stills
    beat videos because a video makes a poor tile, and the earliest photo of the
    day breaks the tie.
    """
    return min(photos, key=lambda photo: (photo.video, -(photo.rating or 0)))


def memory_candidates(user):
    """Photos eligible to appear in a memory.

    ``build_photo_queryset`` gives the same set the timeline shows -- the user's
    own photos, not hidden, not in the trash, thumbnailed, and only the primary
    photo of a stack so a RAW/JPEG pair is not shown twice. Screenshots and
    documents are dropped on top of that: they are photos the user took, but a
    screenshot from four years ago is not a memory of anything.
    """
    return build_photo_queryset(user, {}).filter(
        removed=False, is_screenshot=False, is_document=False
    )


class MemoriesView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "date",
                OpenApiTypes.DATE,
                description="Anniversary to look up, defaults to the user's today.",
            ),
            OpenApiParameter(
                "window",
                OpenApiTypes.INT,
                description=(
                    f"Days either side of the anniversary to include "
                    f"(default {DEFAULT_WINDOW_DAYS}, max {MAX_WINDOW_DAYS})."
                ),
            ),
            OpenApiParameter(
                "fallback",
                OpenApiTypes.BOOL,
                description=(
                    "Whether to widen an empty result to whole months "
                    "(default true). Pass false for a strict anniversary lookup."
                ),
            ),
            OpenApiParameter(
                "size",
                OpenApiTypes.INT,
                description=(
                    f"Photos returned per memory (default "
                    f"{DEFAULT_ITEMS_PER_MEMORY}, max {MAX_ITEMS_PER_MEMORY}). "
                    "``numberOfItems`` always reports the full count."
                ),
            ),
        ],
        description=(
            "Memories for a given day: one entry per earlier year that has "
            "photos around the same date, nearest year first. Titles are left "
            "to the client, which has the translations: an entry carries its "
            "``type``, ``years_ago`` and dates instead of a sentence."
        ),
    )
    def get(self, request, format=None):
        user = request.user
        reference = parse_date(request.query_params.get("date")) or today_for_user(user)
        window_days = clamp_int(
            request.query_params.get("window"), DEFAULT_WINDOW_DAYS, 0, MAX_WINDOW_DAYS
        )
        fallback = parse_flag(request.query_params.get("fallback"), True)
        size = clamp_int(
            request.query_params.get("size"),
            DEFAULT_ITEMS_PER_MEMORY,
            1,
            MAX_ITEMS_PER_MEMORY,
        )

        first_date = AlbumDate.objects.filter(owner=user, date__isnull=False).aggregate(
            Min("date")
        )["date__min"]

        results = []
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

    def memories(self, user, windows, size, memory_type):
        """Build one memory per window that has any photos in it."""
        if not windows:
            return []

        day_filter = Q()
        for _, _, start, end in windows:
            day_filter |= Q(date__range=(start, end))

        # (date, location) for every candidate day, in one query. A library
        # spanning 20 years contributes at most a few hundred rows here.
        day_rows = list(
            AlbumDate.objects.filter(owner=user)
            .filter(day_filter)
            .values_list("date", "location")
        )
        if not day_rows:
            return []

        places = {}
        for day, location in day_rows:
            place = album_date_place(location)
            if place:
                places.setdefault(day, place)

        candidates = memory_candidates(user)

        # How big each candidate day is, grouped in the database rather than
        # counted in Python: a day of 2000 burst frames costs the same here as a
        # day of two.
        counts = dict(
            candidates.filter(albumdate__date__in=[day for day, _ in day_rows])
            .values_list("albumdate__date")
            .annotate(total=Count("id", distinct=True))
        )

        planned = []
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
                candidates.filter(albumdate__date__range=(start, end))
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

        results = []
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
                    "cover": PhotoSummarySerializer(pick_cover(items)).data,
                    "items": PhotoSummarySerializer(items, many=True).data,
                }
            )
        return results
