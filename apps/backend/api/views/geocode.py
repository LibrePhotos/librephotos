from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.geocode.geocode import search_location


class GeocodeSearchView(APIView):
    """Search for locations by name/address."""

    def get(self, request: Request, format: str | None = None) -> Response:
        query = request.query_params.get("q", "").strip()
        if not query:
            return Response([])
        limit = int(request.query_params.get("limit", 5))
        results = search_location(query, limit=limit)
        return Response(results)
