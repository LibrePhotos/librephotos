"""Request input of the admin server views (``api/views/dataviz.py``)."""

from rest_framework import serializers

from api.drf.params import ClampedIntegerField


class ServerLogsQuery(serializers.Serializer[None]):
    lines = ClampedIntegerField(
        default=100,
        lowest=1,
        highest=1000,
        help_text="Lines from the end of the log (1 to 1000)",
    )
