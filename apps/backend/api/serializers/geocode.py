"""Request input and answers of the geocode views (``api/views/geocode.py``)."""

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


class GeocodeReverseQuery(serializers.Serializer[None]):
    lat = serializers.FloatField(
        min_value=-90, max_value=90, help_text="Latitude (-90 to 90)"
    )
    lon = serializers.FloatField(
        min_value=-180, max_value=180, help_text="Longitude (-180 to 180)"
    )


class GeocodeReverseResponseSerializer(serializers.Serializer[None]):
    """The answer of ``GET /api/geocode/reverse``: the place name at a spot."""

    enabled = serializers.BooleanField(
        help_text="False when reverse geocoding is turned off on this server"
    )
    place = serializers.CharField(
        allow_null=True,
        help_text="The place name a photo moved there would get; null when "
        "there is none or reverse geocoding is off",
    )


class GeocodeSearchResultSerializer(serializers.Serializer[None]):
    """A place of ``GET /api/geocode/search``, which answers a list of them."""

    display_name = serializers.CharField(help_text="The provider's name for it")
    lat = serializers.FloatField()
    lon = serializers.FloatField()
