"""Request input of the memories view (``api/views/memories.py``)."""

from rest_framework import serializers

from api.views.params import ClampedIntegerField, QueryFlagField

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
