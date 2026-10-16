from django.db.models import Count, Min, Prefetch, Q, QuerySet
from drf_spectacular.utils import extend_schema
from rest_framework import filters, mixins, viewsets
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.serializers import BaseSerializer
from rest_framework.views import APIView

from api.albums.auto_albums import generate_event_albums, regenerate_event_titles
from api.drf.pagination import WholeListPagination
from api.drf.request_user import request_user
from api.jobs.start import start_job
from api.models import AlbumAuto, LongRunningJob, Person, Photo, User
from api.models.photo import visible_photo_q
from api.serializers.album_auto import (
    AlbumAutoEditSerializer,
    AlbumAutoListSerializer,
    AlbumAutoSerializer,
    with_event_cover,
)
from api.serializers.job import JobStartedResponseSerializer
from api.serializers.person import person_groups_prefetch
from api.views.custom_api_view import ListViewSet
from api.views.mixins import PartialUpdateModelMixin


# TODO: This is a fetches with too many queries. We need to optimize this.
# Open, set the cover of (#429), delete, or delete every event album. They are
# made by the auto album job, and the list is AlbumAutoListViewSet.
class AlbumAutoViewSet(
    mixins.RetrieveModelMixin,
    PartialUpdateModelMixin[AlbumAuto],
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = (IsAuthenticated,)
    serializer_class = AlbumAutoSerializer

    def get_serializer_class(self) -> type[BaseSerializer[AlbumAuto]]:
        if self.action == "partial_update":
            return AlbumAutoEditSerializer
        return AlbumAutoSerializer

    def get_queryset(self) -> QuerySet[AlbumAuto]:
        user = self.request.user
        if not isinstance(user, User):
            return AlbumAuto.objects.none()
        if self.action == "partial_update":
            # Only the owner's events; the edit serializer reads no relation.
            return AlbumAuto.objects.owned_by(user)

        return (
            with_event_cover(AlbumAuto.objects.owned_by(user))
            .prefetch_related(
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
                    # PersonSerializer reads both covers of every person.
                    queryset=Person.objects.select_related(
                        "cover_face", "cover_photo"
                    ).annotate(
                        viewable_face_count=Count("faces"),
                    ),
                ),
                # The people's group ids (#1126), one query for the album.
                person_groups_prefetch("photos__faces__person__"),
            )
            .annotate(photo_count=Count(("photos"), distinct=True))
            .filter(Q(photo_count__gt=0))
            .order_by("-timestamp")
        )

    @action(detail=False, methods=["post"])
    def delete_all(self, request: Request) -> Response:
        AlbumAuto.objects.owned_by(request_user(request)).delete()
        return Response("success")


class AlbumAutoListViewSet(ListViewSet):
    permission_classes = (IsAuthenticated,)
    serializer_class = AlbumAutoListSerializer
    pagination_class = WholeListPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = [
        "photos__search_instance__search_captions",
        "photos__search_instance__search_location",
        "photos__faces__person__name",
    ]

    def get_queryset(self) -> QuerySet[AlbumAuto]:
        # Count and cover with the photos the album detail shows: the cover the
        # owner picked (#429) while it is visible, else the first visible photo.
        return (
            with_event_cover(AlbumAuto.objects.owned_by(request_user(self.request)))
            .annotate(
                photo_count=Count(
                    "photos", filter=visible_photo_q("photos__"), distinct=True
                ),
                # When the event began: `timestamp` is only its grouping key,
                # 11h59m before the first photo (api/albums/auto_albums.py).
                start=Min("photos__exif_timestamp", filter=visible_photo_q("photos__")),
            )
            .filter(Q(photo_count__gt=0))
            .prefetch_related(
                # The automatic cover: the first photo taken. Unordered, it
                # was whichever row the database returned first.
                Prefetch(
                    "photos",
                    queryset=Photo.visible.order_by("exif_timestamp", "pk")[:1],
                    to_attr="first_photo",
                )
            )
            .order_by("-timestamp")
        )


class RegenerateAutoAlbumTitles(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        deprecated=True,
        description="Use POST method to re-generate auto album titles.",
        responses=JobStartedResponseSerializer,
    )
    def get(self, request: Request, format: str | None = None) -> Response:
        return self._schedule_auto_album_title_regeneration(request)

    @extend_schema(request=None, responses=JobStartedResponseSerializer)
    def post(self, request: Request, format: str | None = None) -> Response:
        return self._schedule_auto_album_title_regeneration(request)

    def _schedule_auto_album_title_regeneration(
        self, request: Request, format: str | None = None
    ) -> Response:
        user = request_user(request)
        return start_job(
            user,
            LongRunningJob.JOB_GENERATE_AUTO_ALBUM_TITLES,
            regenerate_event_titles,
            user,
            description="the auto album title regeneration",
        )


class AutoAlbumGenerateView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        deprecated=True,
        description="Use POST method to re-generate auto albums.",
        responses=JobStartedResponseSerializer,
    )
    def get(self, request: Request, format: str | None = None) -> Response:
        return self._schedule_auto_album_regeneration(request)

    @extend_schema(request=None, responses=JobStartedResponseSerializer)
    def post(self, request: Request, format: str | None = None) -> Response:
        return self._schedule_auto_album_regeneration(request)

    def _schedule_auto_album_regeneration(self, request: Request) -> Response:
        user = request_user(request)
        return start_job(
            user,
            LongRunningJob.JOB_GENERATE_AUTO_ALBUMS,
            generate_event_albums,
            user,
            description="the auto album generation",
        )
