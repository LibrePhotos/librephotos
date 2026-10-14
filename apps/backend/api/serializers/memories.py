"""Request input and answer of the memories view (``api/views/memories.py``)."""

from rest_framework import serializers

from api.drf.params import ClampedIntegerField, QueryFlagField
from api.serializers.fields import declare_fields
from api.serializers.photos import PhotoSummarySerializer

# What a memory is about (its ``type``). Only date-based memories exist so
# far; the field is there so that place- or person-based ones can be added
# without the frontend having to guess what a memory is about.
TYPE_YEARS_AGO = "years_ago"
TYPE_MONTH_YEARS_AGO = "month_years_ago"
MEMORY_TYPES = (TYPE_YEARS_AGO, TYPE_MONTH_YEARS_AGO)

# Days either side of the anniversary that still count as the same memory. Three
# days keeps a weekend trip together without pulling in an unrelated week.
DEFAULT_WINDOW_DAYS = 3
MAX_WINDOW_DAYS = 30

# Items returned per memory. The whole page is a single request, so this bounds
# the work: a memory reports its true size in ``numberOfItems`` and returns at
# most this many photos to show and to play as a slideshow.
DEFAULT_ITEMS_PER_MEMORY = 30
MAX_ITEMS_PER_MEMORY = 200


class MemoriesQuery(serializers.Serializer[None]):
    date = serializers.DateField(
        required=False,
        help_text="The day to look back from, YYYY-MM-DD (default: today "
        "in the user's timezone)",
    )
    window = ClampedIntegerField(
        default=DEFAULT_WINDOW_DAYS,
        lowest=0,
        highest=MAX_WINDOW_DAYS,
        help_text=f"Days either side of the anniversary (default "
        f"{DEFAULT_WINDOW_DAYS}, max {MAX_WINDOW_DAYS})",
    )
    fallback = QueryFlagField(
        false_values={"false", "0", "f", "no", "off"},
        help_text="Whether to widen an empty result to whole months "
        "(default true). Pass false for a strict anniversary lookup.",
    )
    size = ClampedIntegerField(
        default=DEFAULT_ITEMS_PER_MEMORY,
        lowest=1,
        highest=MAX_ITEMS_PER_MEMORY,
        help_text=f"Photos returned per memory (default "
        f"{DEFAULT_ITEMS_PER_MEMORY}, max {MAX_ITEMS_PER_MEMORY}). "
        "``numberOfItems`` always reports the full count.",
    )


class MemorySerializer(serializers.Serializer[None]):
    """One earlier year with photos around the day."""

    id = serializers.CharField(help_text="{type}-{year}")
    type = serializers.ChoiceField(
        choices=MEMORY_TYPES,
        help_text="years_ago: around the anniversary; month_years_ago: the "
        "whole month, when no year had photos around the day",
    )
    years_ago = serializers.IntegerField()
    year = serializers.IntegerField()
    date = serializers.DateField(help_text="The day nearest the anniversary")
    start_date = serializers.DateField(help_text="The first day with photos")
    end_date = serializers.DateField(help_text="The last day with photos")
    location = serializers.CharField(
        allow_blank=True, help_text='A place of those days; "" without one'
    )
    cover = PhotoSummarySerializer()
    items = PhotoSummarySerializer(
        many=True, help_text="At most size photos, in the order they were taken"
    )


# Camel case predates the naming rule (LEGACY_CAMEL_CASE_FIELDS).
declare_fields(
    MemorySerializer,
    numberOfItems=serializers.IntegerField(
        help_text="Every photo of the memory, also those items leaves out"
    ),
)


class MemoriesSerializer(serializers.Serializer[None]):
    """``GET /api/memories/``: nearest year first."""

    date = serializers.DateField(help_text="The day looked back from")
    window_days = serializers.IntegerField()
    results = MemorySerializer(many=True)
