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
    num_places = serializers.IntegerField(
        help_text="The towns the user's photos were taken in"
    )
    library_bytes = serializers.IntegerField(
        help_text="The size of the user's photo and video files, in bytes"
    )


class RankStatSerializer(serializers.Serializer[None]):
    value = serializers.CharField(help_text="The value the search filters on")
    count = serializers.IntegerField()


declare_fields(
    RankStatSerializer, label=serializers.CharField(help_text="The shown name")
)


class CameraStatSerializer(RankStatSerializer):
    make = serializers.CharField(
        allow_blank=True,
        help_text="The camera maker the search filters on, blank when some of the "
        "model's photos have none: the row then counts the model with any maker",
    )


class RangeBucketSerializer(serializers.Serializer[None]):
    min = serializers.FloatField(
        help_text="The lowest value of the bucket's photos, the range search's lower end"
    )
    max = serializers.FloatField(
        help_text="The highest value of the bucket's photos, the range search's upper end"
    )
    count = serializers.IntegerField()


declare_fields(
    RangeBucketSerializer,
    label=serializers.CharField(
        help_text="The bucket's name: a standard ISO, f-number or shutter speed, "
        "or a focal length band"
    ),
)


class CameraStatsSerializer(serializers.Serializer[None]):
    cameras = CameraStatSerializer(many=True)
    lenses = RankStatSerializer(many=True)
    iso = RangeBucketSerializer(many=True, help_text="Third stops of ISO, lowest first")
    aperture = RangeBucketSerializer(
        many=True, help_text="Third stops of the f-number, widest first"
    )
    focal_length = RangeBucketSerializer(
        many=True, help_text="Focal length bands in mm, shortest first"
    )
    focal_length_35mm = RangeBucketSerializer(
        many=True, help_text="35 mm equivalent focal length bands, shortest first"
    )
    shutter_speed = RangeBucketSerializer(
        many=True,
        help_text="Whole stops of the exposure time in seconds, fastest first",
    )


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


class PhotoDayCountSerializer(serializers.Serializer[None]):
    day = serializers.DateField(help_text='"YYYY-MM-DD"')
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
