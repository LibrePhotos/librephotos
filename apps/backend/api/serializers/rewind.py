"""Request input and answer of ``GET /api/rewind/`` (``api/views/rewind.py``)."""

from rest_framework import serializers

from api.serializers.photos import PhotoSummarySerializer


class RewindQuery(serializers.Serializer[None]):
    year = serializers.IntegerField(
        required=False,
        min_value=1900,
        max_value=9999,
        help_text="The year to look back on (default: this year; last year in"
        " January, in the user's timezone)",
    )


class RewindDaySerializer(serializers.Serializer[None]):
    date = serializers.DateField()
    count = serializers.IntegerField(help_text="Photos and videos of the day")


class RewindPersonSerializer(serializers.Serializer[None]):
    id = serializers.IntegerField()
    name = serializers.CharField()
    photo_count = serializers.IntegerField(help_text="Photos of the year they are on")
    face_url = serializers.CharField(
        allow_null=True, help_text="Their cover face's crop, null without one"
    )


class RewindPlaceSerializer(serializers.Serializer[None]):
    name = serializers.CharField(help_text="The town, as the day albums name it")
    photo_count = serializers.IntegerField()


class RewindSerializer(serializers.Serializer[None]):
    """A user's year in photos: only their own, as their timeline shows them."""

    year = serializers.IntegerField()
    photo_count = serializers.IntegerField(help_text="Photos, without videos")
    video_count = serializers.IntegerField()
    months = serializers.ListField(
        child=serializers.IntegerField(),
        help_text="Photos and videos per month, January first (12 entries)",
    )
    busiest_day = RewindDaySerializer(
        allow_null=True, help_text="The day with the most photos; null without any"
    )
    busiest_day_photos = PhotoSummarySerializer(
        many=True, help_text="A few photos of the busiest day, best first"
    )
    cover_photos = PhotoSummarySerializer(
        many=True, help_text="The best photo of each of the busiest days"
    )
    people = RewindPersonSerializer(
        many=True, help_text="The named people on the most photos, most first"
    )
    place_count = serializers.IntegerField(help_text="Towns photos were taken in")
    country_count = serializers.IntegerField()
    top_places = RewindPlaceSerializer(
        many=True, help_text="The towns with the most photos"
    )
