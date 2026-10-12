"""Request input of the geocode search (``api/views/geocode.py``)."""

from rest_framework import serializers

from api.drf.params import ClampedIntegerField

# Results a provider is asked for at most; the providers cap lower themselves.
MAX_GEOCODE_RESULTS = 50


class GeocodeSearchQuery(serializers.Serializer[None]):
    q = serializers.CharField(
        default="", allow_blank=True, help_text="Place name or address"
    )
    limit = ClampedIntegerField(
        default=5,
        lowest=1,
        highest=MAX_GEOCODE_RESULTS,
        help_text=f"Results wanted (1 to {MAX_GEOCODE_RESULTS})",
    )
