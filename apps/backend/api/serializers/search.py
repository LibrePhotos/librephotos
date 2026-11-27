"""Request input and answers of the search views (``api/views/search.py``).

The structured search filters themselves are
``api.search.metadata_filter.MetadataFilterQuery``: search and select-all,
both domain code, read them.
"""

from rest_framework import serializers

from api.search.metadata_filter import VALUE_COLUMNS

SEARCH_SORT_CHOICES = [
    ("relevance", "Best match"),
    ("newest", "Newest"),
    ("oldest", "Oldest"),
    ("largest", "Largest"),
    ("smallest", "Smallest"),
]


class SearchListQuery(serializers.Serializer[None]):
    search = serializers.CharField(
        required=False,
        allow_blank=True,
        default="",
        help_text="The words. Dates, named people and places in them become "
        "filters; the rest is matched as words and by meaning",
    )
    language = serializers.CharField(
        required=False,
        allow_blank=True,
        default="",
        max_length=16,
        help_text="The app language of the searcher, for example de or pt_BR: "
        "words that name a thing in it also search for the thing",
    )
    sort = serializers.ChoiceField(
        choices=SEARCH_SORT_CHOICES,
        default="relevance",
        help_text="relevance (the default): the best matches first with "
        "semantic search on, newest first otherwise; newest or oldest: by "
        "date, grouped by day with semantic search off; largest or smallest: "
        "a flat list by file size",
    )


class MetadataValuesQuery(serializers.Serializer[None]):
    field = serializers.ChoiceField(
        choices=list(VALUE_COLUMNS),
        help_text="camera (model), make (camera maker) or lens (model)",
    )


class MetadataValueSerializer(serializers.Serializer[None]):
    value = serializers.CharField(help_text="As stored; filters match it ignoring case")
    count = serializers.IntegerField(help_text="The requester's photos with it")


class MetadataValuesSerializer(serializers.Serializer[None]):
    """``GET /api/search/metadata-values/``: most photos first."""

    results = MetadataValueSerializer(many=True)


class SearchTermExamplesSerializer(serializers.Serializer[None]):
    """``GET /api/searchtermexamples/``: search suggestions from the caller's library."""

    results = serializers.ListField(
        child=serializers.CharField(),
        help_text="Built from a sample of the caller's photos (people, places, "
        "things, times); fixed examples for an empty library",
    )
