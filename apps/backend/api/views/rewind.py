"""``GET /api/rewind/``: the caller's year in photos (``api.dataviz.rewind``)."""

import uuid

from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.dataviz.rewind import build_rewind, rewind_year
from api.drf.params import parse_query
from api.drf.request_user import request_user
from api.models import Photo
from api.serializers.photos import (
    PhotoSummarySerializer,
    with_photo_summary_relations,
)
from api.serializers.rewind import RewindQuery, RewindSerializer
from api.views.memories import today_for_user


class RewindView(APIView):
    """The caller's Rewind: their own photos of one year, never shared ones."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(parameters=[RewindQuery], responses=RewindSerializer)
    def get(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        params = parse_query(request, RewindQuery)
        year = params.get("year") or rewind_year(today_for_user(user))
        rewind = build_rewind(user, year)
        wanted = [*rewind["busiest_day_photo_ids"], *rewind["cover_photo_ids"]]
        photos = {
            photo.id: photo
            for photo in with_photo_summary_relations(
                Photo.objects.owned_by(user).filter(id__in=wanted)
            )
        }
        context = {"request": request}

        def summaries(ids: list[uuid.UUID]) -> object:
            found = [photos[photo_id] for photo_id in ids if photo_id in photos]
            return PhotoSummarySerializer(found, many=True, context=context).data

        busiest = rewind["busiest_day"]
        return Response(
            {
                "year": rewind["year"],
                "photo_count": rewind["photo_count"],
                "video_count": rewind["video_count"],
                "months": rewind["months"],
                "busiest_day": (
                    {"date": busiest["date"].isoformat(), "count": busiest["count"]}
                    if busiest
                    else None
                ),
                "busiest_day_photos": summaries(rewind["busiest_day_photo_ids"]),
                "cover_photos": summaries(rewind["cover_photo_ids"]),
                "people": rewind["people"],
                "place_count": rewind["place_count"],
                "country_count": rewind["country_count"],
                "top_places": rewind["top_places"],
            }
        )
