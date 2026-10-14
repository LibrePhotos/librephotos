from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.drf.params import parse_query
from api.geocode.geocode import reverse_geocode_label, search_location
from api.serializers.geocode import (
    GeocodeReverseQuery,
    GeocodeReverseResponseSerializer,
    GeocodeSearchQuery,
    GeocodeSearchResultSerializer,
)


class GeocodeSearchView(APIView):
    """Search for locations by name/address."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[GeocodeSearchQuery],
        responses=GeocodeSearchResultSerializer(many=True),
    )
    def get(self, request: Request, format: str | None = None) -> Response:
        params = parse_query(request, GeocodeSearchQuery)
        if not params["q"]:
            return Response([])
        results = search_location(params["q"], limit=params["limit"])
        return Response(results)


class GeocodeReverseView(APIView):
    """The place name at a spot, for the location picker before it saves (#2283).

    The same text a photo moved there gets as its search location. A spot the
    provider cannot name answers ``place: null``; with reverse geocoding
    turned off, ``enabled: false`` as well.
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[GeocodeReverseQuery], responses=GeocodeReverseResponseSerializer
    )
    def get(self, request: Request, format: str | None = None) -> Response:
        params = parse_query(request, GeocodeReverseQuery)
        label = reverse_geocode_label(params["lat"], params["lon"])
        return Response({"enabled": label is not None, "place": label or None})
