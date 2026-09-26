from django.db.models import Count, Prefetch, Q
from django_q.tasks import AsyncTask
from drf_spectacular.utils import extend_schema
from rest_framework import filters, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView

from api.autoalbum import generate_event_albums, regenerate_event_titles
from api.models import AlbumAuto, Person, Photo
from api.serializers.album_auto import AlbumAutoListSerializer, AlbumAutoSerializer
from api.views.custom_api_view import ListViewSet
from api.views.pagination import StandardResultsSetPagination
from api.views.views import start_job


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
                # PhotoSimpleSerializer renders the square thumbnail of every
                # photo, which costs a query each without this join (issue #619).
                Prefetch("photos", queryset=Photo.visible.select_related("thumbnail")),
                Prefetch("photos__faces"),
                # No cover-face annotations here: `face_url`, `face_photo_url`
                # and `video` are `SerializerMethodField`s on PersonSerializer,
                # so DRF calls the getters and an annotation of the same name is
                # never read. This view carried three such annotations and they
                # had been dead for a while (#2047). The live ones live on
                # PersonViewSet under names the serializer actually reads
                # (`first_face_*`, #2042). They are not ported here because the
                # semantics differ deliberately -- the dead ones excluded hidden
                # and trashed photos and ordered by `added_on` -- so reviving
                # them would change which face this page shows, which is a
                # behaviour decision rather than a cleanup.
                Prefetch(
                    "photos__faces__person",
                    queryset=Person.objects.all().annotate(
                        viewable_face_count=Count("faces"),
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
        "photos__search_instance__search_captions",
        "photos__search_instance__search_location",
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
        return start_job(
            lambda job_id: AsyncTask(
                regenerate_event_titles, request.user, job_id
            ).run(),
            "the auto album title regeneration",
        )


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
        return start_job(
            lambda job_id: AsyncTask(generate_event_albums, request.user, job_id).run(),
            "the auto album generation",
        )
