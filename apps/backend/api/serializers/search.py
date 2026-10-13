"""Request input and answers of the search views (``api/views/search.py``).

The structured search filters themselves are
``api.search.metadata_filter.MetadataFilterQuery``: search and select-all,
both domain code, read them.
"""

from rest_framework import serializers

from api.search.metadata_filter import VALUE_COLUMNS


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
