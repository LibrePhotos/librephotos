import uuid

from django.db.models import Count, OuterRef, Prefetch, Q, Subquery
from django_q.tasks import AsyncTask
from drf_spectacular.utils import extend_schema
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from api.autoalbum import generate_event_albums, regenerate_event_titles
from api.models import AlbumAuto, Face, Person, Photo
from api.serializers.album_auto import AlbumAutoListSerializer, AlbumAutoSerializer
from api.util import logger
from api.views.custom_api_view import ListViewSet
from api.views.pagination import StandardResultsSetPagination


# TODO: This is a fetches with too many queries. We need to optimize this.
class AlbumAutoViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumAutoSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        if self.request.user.is_anonymous:
            return AlbumAuto.objects.none()

        return (
            AlbumAuto.objects.prefetch_related(
                Prefetch("owner"),
                Prefetch("photos", queryset=Photo.visible.all()),
                Prefetch("photos__faces"),
                Prefetch(
                    "photos__faces__person",
                    queryset=Person.objects.all().annotate(
                        viewable_face_count=Count("faces"),
                        face_url=Subquery(
                            Face.objects.filter(
                                person=OuterRef("pk"),
                                photo__hidden=False,
                                photo__in_trashcan=False,
                                photo__owner=self.request.user,
                            )
                            .order_by("id")
                            .values("image")[:1]
                        ),
                        face_photo_url=Subquery(
                            Photo.objects.filter(
                                faces__person=OuterRef("pk"),
                                hidden=False,
                                in_trashcan=False,
                                owner=self.request.user,
                            )
                            .order_by("added_on")
                            .values("image_hash")[:1]
                        ),
                        video=Subquery(
                            Photo.objects.filter(
                                faces__person=OuterRef("pk"),
                                hidden=False,
                                in_trashcan=False,
                                owner=self.request.user,
                            )
                            .order_by("added_on")
                            .values("video")[:1]
                        ),
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


# TODO: Add custom covers for auto album
class AlbumAutoListViewSet(ListViewSet):
    serializer_class = AlbumAutoListSerializer
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = [
        "photos__search_captions",
        "photos__search_location",
        "photos__faces__person__name",
    ]

    def get_queryset(self):
        cover_photo_query = Photo.objects.filter(hidden=False)
        return (
            AlbumAuto.objects.annotate(
                photo_count=Count(
                    "photos", filter=Q(photos__hidden=False), distinct=True
                )
            )
            .filter(Q(photo_count__gt=0) & Q(owner=self.request.user))
            .prefetch_related(
                Prefetch(
                    "photos", queryset=cover_photo_query[:1], to_attr="cover_photo"
                )
            )
            .order_by("-timestamp")
        )


class RegenerateAutoAlbumTitles(APIView):
    @extend_schema(
        deprecated=True,
        description="Use POST method to re-generate auto album titles.",
    )
    def get(self, request, format=None):
        return self._schedule_auto_album_title_regeneration(request)

    def post(self, request, format=None):
        return self._schedule_auto_album_title_regeneration(request)

    def _schedule_auto_album_title_regeneration(self, request, format=None):
        try:
            job_id = uuid.uuid4()
            AsyncTask(regenerate_event_titles, request.user, job_id).run()
            return Response({"status": True, "job_id": job_id})
        except BaseException as e:
            logger.error(str(e))
            return Response({"status": False})


class AutoAlbumGenerateView(APIView):
    @extend_schema(
        deprecated=True,
        description="Use POST method to re-generate auto albums.",
    )
    def get(self, request, format=None):
        return self._schedule_auto_album_regeneration(request)

    def post(self, request, format=None):
        return self._schedule_auto_album_regeneration(request)

    def _schedule_auto_album_regeneration(self, request):
        try:
            job_id = uuid.uuid4()
            AsyncTask(generate_event_albums, request.user, job_id).run()
            return Response({"status": True, "job_id": job_id})
        except BaseException as e:
            logger.error(str(e))
            return Response({"status": False})
