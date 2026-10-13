"""The answers of the statistics views (``api/views/dataviz.py``), built as dicts
and lists in ``api/dataviz/stats.py`` and ``api/faces/social_graph.py``.

Only for the OpenAPI schema: the views render what those functions return.
"""

from rest_framework import serializers

from api.serializers.fields import declare_fields


class CountStatsSerializer(serializers.Serializer[None]):
    """``GET /api/stats/`` (``api.dataviz.stats.get_count_stats``)."""

    num_photos = serializers.IntegerField()
    num_screenshots = serializers.IntegerField()
    num_documents = serializers.IntegerField()
    num_missing_photos = serializers.IntegerField()
    num_faces = serializers.IntegerField()
    num_people = serializers.IntegerField()
    num_unknown_faces = serializers.IntegerField()
    num_labeled_faces = serializers.IntegerField()
    num_inferred_faces = serializers.IntegerField()
    num_albumauto = serializers.IntegerField()
    num_albumdate = serializers.IntegerField()
    num_albumuser = serializers.IntegerField()


class WordCloudEntrySerializer(serializers.Serializer[None]):
    y = serializers.FloatField(help_text="The natural log of the label's count")


declare_fields(WordCloudEntrySerializer, label=serializers.CharField())


class WordCloudSerializer(serializers.Serializer[None]):
    """``GET /api/wordcloud/``: the 100 most frequent OpenCLIP tags, people and places."""

    captions = WordCloudEntrySerializer(many=True)
    people = WordCloudEntrySerializer(many=True)
    locations = WordCloudEntrySerializer(many=True)


class PhotoMonthCountSerializer(serializers.Serializer[None]):
    """One month of ``GET /api/photomonthcounts/``, every month from the first to the last."""

    month = serializers.CharField(help_text='"YYYY-M", the month not zero-padded')
    count = serializers.IntegerField()


class LocationTimelineSpanSerializer(serializers.Serializer[None]):
    """One stretch of ``GET /api/locationtimeline/``: photos taken in one place in a row."""

    color = serializers.CharField()
    loc = serializers.CharField(help_text="The place (the last geocoding feature)")
    start = serializers.FloatField(help_text="Unix timestamp")
    end = serializers.FloatField(help_text="Unix timestamp: the next stretch's start")


declare_fields(
    LocationTimelineSpanSerializer,
    data=serializers.ListField(
        child=serializers.FloatField(), help_text="One value: the duration in seconds"
    ),
)


class LocationSunburstSerializer(serializers.Serializer[None]):
    """A node of ``GET /api/locationsunburst/`` (``SunburstNode``): the root, a
    place with the places in it, or a leaf with its photo count."""

    name = serializers.CharField()
    hex = serializers.CharField(required=False, help_text="Absent on the root")
    value = serializers.IntegerField(required=False, help_text="Leaves only")


declare_fields(
    LocationSunburstSerializer,
    children=LocationSunburstSerializer(
        many=True, required=False, help_text="Absent on leaves"
    ),
)


class SocialGraphNodeSerializer(serializers.Serializer[None]):
    id = serializers.CharField(help_text="The person's name")
    x = serializers.FloatField()
    y = serializers.FloatField()


class SocialGraphLinkSerializer(serializers.Serializer[None]):
    target = serializers.CharField(help_text="A person's name")


declare_fields(
    SocialGraphLinkSerializer, source=serializers.CharField(help_text="A person's name")
)


class SocialGraphSerializer(serializers.Serializer[None]):
    """``GET /api/socialgraph/``: people laid out on a plane, linked when they share a photo."""

    nodes = SocialGraphNodeSerializer(many=True)
    links = SocialGraphLinkSerializer(many=True)
