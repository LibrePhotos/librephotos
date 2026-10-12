from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.geocode.geocode import search_location
from api.serializers.geocode import GeocodeSearchQuery
from api.views.params import parse_query


class GeocodeSearchView(APIView):
    """Search for locations by name/address."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(parameters=[GeocodeSearchQuery])
    def get(self, request: Request, format: str | None = None) -> Response:
        params = parse_query(request, GeocodeSearchQuery)
        if not params["q"]:
            return Response([])
        results = search_location(params["q"], limit=params["limit"])
        return Response(results)
