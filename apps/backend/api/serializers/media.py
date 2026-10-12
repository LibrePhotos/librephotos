"""Request input of the media views (``api/views/media.py``)."""

from rest_framework import serializers

from api.drf.params import QueryFlagField


class MediaQuery(serializers.Serializer[None]):
    transcode = QueryFlagField(
        true_values={"1"},
        help_text="1 asks for a video this browser cannot play to be converted",
    )
