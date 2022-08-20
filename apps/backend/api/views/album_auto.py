import uuid

from django.db.models import Count, Prefetch, Q
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from api.autoalbum import generate_event_albums, regenerate_event_titles
from api.models import AlbumAuto, Person, Photo
from api.serializers.album_auto import AlbumAutoListSerializer, AlbumAutoSerializer
from api.util import logger
from api.views.pagination import StandardResultsSetPagination


# TODO: This is a fetches with too many queries. We need to optimize this.
class AlbumAutoViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumAutoSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        return (
            AlbumAuto.objects.prefetch_related(
                Prefetch("owner"),
                Prefetch("photos", queryset=Photo.visible.all()),
                Prefetch("photos__faces"),
                Prefetch(
                    "photos__faces__person",
                    queryset=Person.objects.all().annotate(
                        viewable_face_count=Count("faces")
                    ),
                ),
            )
            .annotate(photo_count=Count(("photos"), distinct=True))
            .filter(Q(photo_count__gt=0) & Q(owner=self.request.user))
            .order_by("-timestamp")
        )

    @action(detail=False, methods=["post"])
    def delete_all(self, request):
        AlbumAuto.objects.filter(owner=request.user).all().delete()
        return Response("success")

    def retrieve(self, *args, **kwargs):
        return super(AlbumAutoViewSet, self).retrieve(*args, **kwargs)

    def list(self, *args, **kwargs):
        return super(AlbumAutoViewSet, self).list(*args, **kwargs)


# TODO: Prefetch only the cover_image or just add custom covers for auto album
class AlbumAutoListViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumAutoListSerializer
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = [
        "photos__search_captions",
        "photos__search_location",
        "photos__faces__person__name",
    ]

    def get_queryset(self):
        return (
            AlbumAuto.objects.annotate(
                photo_count=Count(
                    "photos", filter=Q(photos__hidden=False), distinct=True
                )
            )
            .filter(Q(photo_count__gt=0) & Q(owner=self.request.user))
            .order_by("-timestamp")
        )

    def retrieve(self, *args, **kwargs):
        return super(AlbumAutoListViewSet, self).retrieve(*args, **kwargs)

    def list(self, *args, **kwargs):
        return super(AlbumAutoListViewSet, self).list(*args, **kwargs)


class RegenerateAutoAlbumTitles(APIView):
    def get(self, request, format=None):
        try:
            job_id = uuid.uuid4()
            regenerate_event_titles.delay(request.user, job_id)
            return Response({"status": True, "job_id": job_id})
        except BaseException as e:
            logger.error(str(e))
            return Response({"status": False})


class AutoAlbumGenerateView(APIView):
    def get(self, request, format=None):
        try:
            job_id = uuid.uuid4()
            generate_event_albums.delay(request.user, job_id)
            return Response({"status": True, "job_id": job_id})
        except BaseException as e:
            logger.error(str(e))
            return Response({"status": False})
