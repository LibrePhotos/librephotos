import logging
from functools import cached_property
from typing import Any

from django.db.models import Count, Exists, F, OuterRef, Prefetch, Q, QuerySet, Subquery
from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiTypes,
    extend_schema,
    extend_schema_view,
)
from rest_framework import filters, mixins, serializers, viewsets
from rest_framework.decorators import action
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import (
    SAFE_METHODS,
    AllowAny,
    BasePermission,
    IsAuthenticated,
)
from rest_framework.request import Request
from rest_framework.response import Response

from api.albums.collections import set_album_collections
from api.albums.timeline_filter import timeline_filter_q
from api.drf.pagination import (
    DAY_ALBUM_PAGE_PARAMETERS,
    DayAlbumPagination,
    WholeListPagination,
)
from api.drf.params import parse_body, parse_query
from api.drf.request_user import request_user
from api.faces.labels import relabel_faces
from api.faces.merge import merge_people
from api.models import (
    AlbumCollection,
    AlbumDate,
    AlbumPlace,
    AlbumThing,
    AlbumUser,
    Face,
    Person,
    Photo,
    User,
)
from api.models.photo import visible_photo_q
from api.models.photo_stack import PhotoStack
from api.photos.paths import folder_path_q
from api.serializers.album_collection import (
    UserAlbumCollectionsRequest,
    UserAlbumCollectionsSerializer,
)
from api.serializers.album_date import (
    AlbumDateListQuery,
    AlbumDateSerializer,
    DateAlbumFilterQuery,
    IncompleteAlbumDateSerializer,
    PublicViewQuery,
    prefetch_public_photos,
)
from api.serializers.album_place import (
    AlbumPlaceListSerializer,
    AlbumPlaceSerializer,
    GroupedPlacePhotosSerializer,
)
from api.serializers.album_thing import (
    AlbumThingListSerializer,
    AlbumThingSerializer,
    GroupedThingPhotosSerializer,
)
from api.serializers.album_user import (
    AlbumUserEditSerializer,
    AlbumUserListQuery,
    AlbumUserListSerializer,
    AlbumUserPublicSerializer,
    AlbumUserQuery,
    AlbumUserSerializer,
    with_album_user_list_relations,
)
from api.serializers.person import (
    PersonMergeRequest,
    PersonMergeResponseSerializer,
    PersonRemovePhotosRequest,
    PersonRemovePhotosResponseSerializer,
    PersonSerializer,
    first_face_of_person,
)
from api.serializers.photos import (
    PhotoSummarySerializer,
)
from api.serializers.photos import (
    # Kept under its old name for the views that import it from here.
    with_photo_summary_relations as _with_photo_summary_relations,
)
from api.views.custom_api_view import ListViewSet
from api.views.mixins import PartialUpdateModelMixin

logger = logging.getLogger(__name__)


class PersonViewSet(
    mixins.ListModelMixin,
    mixins.RetrieveModelMixin,
    PartialUpdateModelMixin[Person],
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    permission_classes = (IsAuthenticated,)
    serializer_class = PersonSerializer
    pagination_class = WholeListPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = ["name"]
    ordering_fields = ["name"]

    def get_queryset(self) -> QuerySet[Person]:
        user = self.request.user
        if not isinstance(user, User):
            return Person.objects.none()
        # People without an explicit cover fall back to their first face.
        # Resolving that in the serializer costs eight queries per person, so
        # the values are pulled in with the page instead (issue #618).
        first_face = first_face_of_person(user)
        qs = (
            Person.objects.owned_by(user)
            .filter(kind=Person.KIND_USER)
            .select_related("cover_photo", "cover_face")
            .only(
                "name",
                "face_count",
                "id",
                "cover_face",
                "cover_photo",
            )
            .annotate(
                first_face_image=Subquery(first_face.values("image")[:1]),
                first_face_photo_hash=Subquery(
                    first_face.values("photo__image_hash")[:1]
                ),
                first_face_photo_video=Subquery(first_face.values("photo__video")[:1]),
            )
            .order_by("name")
        )

        return qs

    @extend_schema(
        description=(
            "Take this person off the given photos: the person's faces on them "
            'go back to unknown, as "Not this person" does in the face '
            "dashboard. Photos that are not the requester's, or that do not "
            "show this person, are ignored."
        ),
        request=PersonRemovePhotosRequest,
        responses={200: PersonRemovePhotosResponseSerializer},
    )
    @action(detail=True, methods=["post"], url_path="remove-photos")
    def remove_photos(self, request: Request, pk: str | None = None) -> Response:
        user = request_user(request)
        person = self.get_object()
        photo_ids = parse_body(request, PersonRemovePhotosRequest)["photo_ids"]
        result = relabel_faces(
            user,
            Face.objects.owned_by(user).filter(person=person, photo_id__in=photo_ids),
            None,
        )
        return Response(
            {
                "removed": len(result.faces),
                "photo_count": len(result.photos),
                "write_error": result.write_error,
            }
        )

    @extend_schema(
        description=(
            "Merge another person into this one: all of their faces (labelled "
            "and suggested) and clusters move here, this person keeps their "
            "name and cover, and the merged person is deleted. Both must be "
            "the requester's own named people."
        ),
        request=PersonMergeRequest,
        responses={200: PersonMergeResponseSerializer},
    )
    @action(detail=True, methods=["post"], url_path="merge")
    def merge(self, request: Request, pk: str | None = None) -> Response:
        user = request_user(request)
        target = self.get_object()
        source_id = parse_body(request, PersonMergeRequest)["person"]
        source = self.get_queryset().filter(pk=source_id).first()
        if source is None:
            raise NotFound()
        if source.pk == target.pk:
            raise ValidationError(
                {"person": "A person cannot be merged into themselves"},
                code="self_merge",
            )
        result = merge_people(user, source, target)
        return Response(
            {
                "moved": result.moved,
                "photo_count": result.photo_count,
                "write_queued": result.write_queued,
            }
        )


def _get_active_tag_thing_types() -> list[str]:
    """Return the AlbumThing thing_type values of the tagger's albums."""
    from api.search.semantic import TAG_THING_TYPE

    return [TAG_THING_TYPE]


def _thing_has_visible_photo() -> Exists:
    """Whether a thing album holds a photo its detail shows.

    The list and the detail both gate on it, so a listed card always opens.
    An EXISTS stops at the first such photo: counting every album's visible
    photos per request took seconds on a 250k-photo library.
    """
    return Exists(
        AlbumThing.photos.through.objects.filter(albumthing_id=OuterRef("pk")).filter(
            visible_photo_q("photo__")
        )
    )


# Retrieve only: the list is AlbumThingListViewSet, and thing albums are made
# by the tagger, never through the API.
class AlbumThingViewSet(mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = (IsAuthenticated,)
    serializer_class = AlbumThingSerializer

    def _album_queryset(self) -> QuerySet[AlbumThing]:
        """The requesting user's non-empty thing albums, ready to serialize."""
        user = self.request.user
        if not isinstance(user, User):
            return AlbumThing.objects.none()
        return (
            AlbumThing.objects.owned_by(user)
            .filter(_thing_has_visible_photo())
            .prefetch_related(
                Prefetch(
                    "photos",
                    queryset=_with_photo_summary_relations(
                        Photo.visible.order_by("-exif_timestamp")
                    ),
                ),
            )
            .order_by("title")
        )

    def get_queryset(self) -> QuerySet[AlbumThing]:
        if not isinstance(self.request.user, User):
            return AlbumThing.objects.none()
        active_types = _get_active_tag_thing_types()
        return self._album_queryset().filter(
            Q(thing_type__in=active_types) | Q(thing_type="hashtag_attribute")
        )

    def retrieve(self, *args: Any, **kwargs: Any) -> Response:
        # A missing album used to serialize as {"title": ""} with a 200.
        album = get_object_or_404(self.get_queryset(), pk=self.kwargs["pk"])
        serializer = GroupedThingPhotosSerializer(
            album, context={"request": self.request}
        )
        return Response({"results": serializer.data})


# To-Do: Could be literally the list command in AlbumThingViewSet
class AlbumThingListViewSet(ListViewSet):
    permission_classes = (IsAuthenticated,)
    serializer_class = AlbumThingListSerializer
    pagination_class = WholeListPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = ["title"]

    def get_queryset(self) -> QuerySet[AlbumThing]:
        user = self.request.user
        if not isinstance(user, User):
            return AlbumThing.objects.none()

        active_types = _get_active_tag_thing_types()
        # The card shows the stored photo_count. The covers come from the
        # album's visible photos, as on the place list: the stored
        # cover_photos are never replaced once hidden or trashed, so an album
        # could be listed with none of them left (#2234).
        cover_photos_query = Photo.visible.only("image_hash", "video")
        queryset = (
            AlbumThing.objects.owned_by(user)
            .filter(_thing_has_visible_photo())
            .prefetch_related(
                Prefetch(
                    "photos",
                    queryset=cover_photos_query[:4],
                    to_attr="visible_cover_photos",
                )
            )
            .filter(Q(thing_type__in=active_types) | Q(thing_type="hashtag_attribute"))
            .order_by("-title")
        )

        return queryset


# Retrieve only: the list is AlbumPlaceListViewSet, and place albums are made
# by reverse geocoding, never through the API.
class AlbumPlaceViewSet(mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    permission_classes = (IsAuthenticated,)
    serializer_class = AlbumPlaceSerializer

    def _album_queryset(self, with_photo_summary: bool = False) -> QuerySet[AlbumPlace]:
        """The requesting user's non-empty place albums.

        The list action renders photos through ``PhotoSuperSimpleSerializer``,
        which reads a handful of columns, while the detail action renders the
        much wider photo summary. Only load the summary relations for the
        detail action, otherwise listing places drags in a thumbnail, a search
        instance, a main file, its embedded media, the stacks and the files of
        every photo of every album on the page for nothing.
        """
        user = self.request.user
        if not isinstance(user, User):
            return AlbumPlace.objects.none()
        photos: QuerySet[Photo] = Photo.visible.order_by("-exif_timestamp")
        if with_photo_summary:
            photos = _with_photo_summary_relations(photos)
        else:
            photos = photos.only(
                "image_hash",
                "public",
                "rating",
                "hidden",
                "exif_timestamp",
                "video",
            )
        return (
            AlbumPlace.objects.owned_by(user)
            .annotate(
                photo_count=Count(
                    "photos", filter=visible_photo_q("photos__"), distinct=True
                )
            )
            .filter(Q(photo_count__gt=0))
            .prefetch_related(Prefetch("photos", queryset=photos))
            .order_by("title")
        )

    def get_queryset(self) -> QuerySet[AlbumPlace]:
        return self._album_queryset()

    def retrieve(self, *args: Any, **kwargs: Any) -> Response:
        album = get_object_or_404(
            self._album_queryset(with_photo_summary=True), pk=self.kwargs["pk"]
        )
        serializer = GroupedPlacePhotosSerializer(
            album, context={"request": self.request}
        )
        return Response({"results": serializer.data})


# To-Do: Could be literally the list command in AlbumPlaceViewSet
class AlbumPlaceListViewSet(ListViewSet):
    permission_classes = (IsAuthenticated,)
    serializer_class = AlbumPlaceListSerializer
    pagination_class = WholeListPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = ["title"]

    def get_queryset(self) -> QuerySet[AlbumPlace]:
        user = self.request.user
        if not isinstance(user, User):
            return AlbumPlace.objects.none()
        cover_photos_query = Photo.visible.only("image_hash", "video")

        return (
            AlbumPlace.objects.owned_by(user)
            # No DISTINCT: a place holds a photo once and the thumbnail join is
            # one-to-one, and COUNT(DISTINCT) sorted every place link.
            .annotate(photo_count=Count("photos", filter=visible_photo_q("photos__")))
            .prefetch_related(
                Prefetch(
                    "photos", queryset=cover_photos_query[:4], to_attr="cover_photos"
                )
            )
            .filter(Q(photo_count__gt=0))
            .order_by("title")
        )


# Albums are created and their photos edited through AlbumUserEditViewSet;
# this one opens an album (also through its public link), renames and deletes
# it.
@extend_schema_view(retrieve=extend_schema(parameters=[AlbumUserQuery]))
class AlbumUserViewSet(
    mixins.RetrieveModelMixin,
    PartialUpdateModelMixin[AlbumUser],
    mixins.DestroyModelMixin,
    viewsets.GenericViewSet,
):
    serializer_class = AlbumUserSerializer

    def get_queryset(self) -> QuerySet[AlbumUser]:
        # Support public access when explicitly requested. Public access is
        # READ-ONLY: only honor ?public for the retrieve action, so a
        # public album id can't be mutated or deleted through this unscoped
        # queryset. See issue #1861.
        if self._public_read():
            # Anyone can view a public album if the album itself is marked public and active (not expired)
            username = parse_query(self.request, AlbumUserQuery)["username"]
            from django.utils import timezone

            # Use share model exclusively
            base_qs = AlbumUser.objects.filter(
                Q(share__enabled=True)
                & (
                    Q(share__expires_at__isnull=True)
                    | Q(share__expires_at__gte=timezone.now())
                )
            )
            if username:
                base_qs = base_qs.filter(owner__username=username)
            return base_qs.order_by("-id")

        user = self.request.user
        if not isinstance(user, User):
            return AlbumUser.objects.none()
        # A share is read-only: recipients may open the album, but renaming
        # (PATCH) and deleting it stay with the owner.
        if self.request.method in SAFE_METHODS:
            return AlbumUser.objects.owned_or_shared_to(user).order_by("-id")
        return AlbumUser.objects.owned_by(user).order_by("-id")

    def _public_read(self) -> bool:
        """A retrieve through the album's public link (``?public``).

        Only a retrieve reads the flag, so a write never fails on it.
        """
        return (
            self.action == "retrieve"
            and parse_query(self.request, PublicViewQuery)["public"]
        )

    def get_permissions(self) -> list[BasePermission]:
        # Anonymous public access is allowed only for retrieve. Write actions
        # (partial_update/destroy) always require authentication,
        # even when ?public is present. See issue #1861.
        permission_classes: list[type[BasePermission]]
        if self._public_read():
            permission_classes = [AllowAny]
        else:
            permission_classes = [IsAuthenticated]
        return [permission() for permission in permission_classes]

    def get_serializer_class(self) -> type[serializers.BaseSerializer[AlbumUser]]:
        if self._public_read():
            return AlbumUserPublicSerializer
        return super().get_serializer_class()

    @extend_schema(
        request=UserAlbumCollectionsRequest,
        responses=UserAlbumCollectionsSerializer,
    )
    @action(detail=True, methods=["put"], url_path="collections")
    def collections(self, request: Request, pk: str | None = None) -> Response:
        """Put the album in exactly the listed collections of its owner (#1009).

        Only the owner: a write resolves the album through ``owned_by``, and
        every id must be one of the requester's collections.
        """
        album = self.get_object()
        chosen = parse_body(request, UserAlbumCollectionsRequest)["collection_ids"]
        return Response({"collection_ids": set_album_collections(album, chosen)})


# To-Do: Could be the list command in AlbumUserViewSet
@extend_schema_view(list=extend_schema(parameters=[AlbumUserListQuery]))
class AlbumUserListViewSet(ListViewSet):
    permission_classes = (IsAuthenticated,)
    serializer_class = AlbumUserListSerializer
    pagination_class = WholeListPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = ["title"]

    def get_queryset(self) -> QuerySet[AlbumUser]:
        user = self.request.user
        if not isinstance(user, User):
            return AlbumUser.objects.none()
        albums = AlbumUser.objects.owned_by(user)
        collection = parse_query(self.request, AlbumUserListQuery).get("collection")
        if collection is not None:
            # Through the requester's collections: another user's id lists nothing.
            albums = albums.filter(
                collections__in=AlbumCollection.objects.owned_by(user).filter(
                    pk=collection
                )
            )
        # Empty albums are listed too: an album can be made before it has
        # photos and filled by an upload (#612), and one whose last photo was
        # removed must not vanish from its owner's list.
        return with_album_user_list_relations(albums).order_by("title")


def public_view_permissions(request: Request) -> list[BasePermission]:
    """Anyone may read the public view (``?public``); the rest needs a sign-in.

    Only the flag is read here, so an anonymous caller without it is answered
    401 before any other parameter is validated.
    """
    if parse_query(request, PublicViewQuery)["public"]:
        return [AllowAny()]
    return [IsAuthenticated()]


# Retrieve only: there is no queryset, so the list, create, update and destroy
# a ModelViewSet adds all failed with a 500. The day list is AlbumDateListViewSet.
class AlbumDateViewSet(mixins.RetrieveModelMixin, viewsets.GenericViewSet):
    serializer_class = AlbumDateSerializer
    pagination_class = DayAlbumPagination

    @cached_property
    def _query(self) -> dict[str, Any]:
        """The query string, validated once per request."""
        return parse_query(self.request, DateAlbumFilterQuery)

    def _ownership_filters(self) -> list[Q]:
        params = self._query
        user = self.request.user

        filters = [Q(thumbnail__aspect_ratio__isnull=False)]
        if isinstance(user, User) and not params["public"]:
            filters.append(Photo.objects.owner_q(user))
        if params["public"]:
            if params["username"]:
                filters.append(Q(owner__username=params["username"]))
            filters.append(Q(public=True))
        return filters

    def _media_flag_filters(self) -> list[Q]:
        params = self._query

        filters = [Q(hidden=params["hidden"])]
        # Media type, screenshots, documents and favorites: resolved exactly as
        # AlbumDateListViewSet does, so a day's pages match its count there.
        filters += timeline_filter_q(self.request.user, params)
        if params["in_trashcan"]:
            filters.append(Q(in_trashcan=True) & Q(removed=False))
        else:
            filters.append(Q(in_trashcan=False))
        return filters

    def _grouping_filters(self) -> list[Q]:
        params = self._query

        filters: list[Q] = []
        folder = params["folder"]
        if folder:
            filters.append(folder_path_q("files__path", folder))
        # Photos that are not stacked, or that are the primary photo of their stack.
        # Non-primary photos stay out of the timeline but remain reachable by
        # expanding the stack. Duplicates are handled via the Duplicate model.
        if not params["show_all_stack_photos"]:
            filters.append(Q(stacks__isnull=True) | Q(primary_in_stack__isnull=False))
        if "person" in params:
            # One Q, so both conditions apply to the same face.
            filters.append(Q(faces__person__id=params["person"], faces__deleted=False))
        return filters

    def _photo_filters(self) -> list[Q]:
        params = self._query

        last_modified = params.get("last_modified")
        # For the owner, last_modified deliberately replaces every other
        # filter. Only reached signed in: get_permissions requires it unless
        # ``public`` is set.
        if last_modified is not None and not params["public"]:
            return [
                Photo.objects.owner_q(request_user(self.request)),
                Q(exif_timestamp__gte=last_modified),
            ]
        filters = (
            self._ownership_filters()
            + self._media_flag_filters()
            + self._grouping_filters()
        )
        # The public view, anonymous or not, stays scoped to public photos.
        if last_modified is not None:
            filters.append(Q(exif_timestamp__gte=last_modified))
        return filters

    def _album_date(self) -> AlbumDate:
        """The requested day album, if the caller may see it; 404 otherwise.

        The serializer renders the album's own ``date`` and ``location``, so
        filtering only the photos is not enough. Mirror the scope of
        ``AlbumDateListViewSet``, which hands out the ids: the caller's own
        days, or with ``public`` the days holding a public photo (of
        ``username``, when given).
        """
        params = self._query
        albums = AlbumDate.objects.all()
        if params["public"]:
            if params["username"]:
                albums = albums.filter(owner__username=params["username"])
            albums = albums.filter(photos__public=True)
        else:
            # Only reached with an authenticated user: get_permissions requires
            # it unless ``public`` is set.
            albums = albums.owned_by(request_user(self.request))
        # DRF's get_object_or_404 also turns a non-numeric id into a 404.
        return get_object_or_404(albums.distinct(), pk=self.kwargs["pk"])

    def _album_date_page(self) -> tuple[AlbumDate, list[Photo]]:
        """The day album and one page of its photos (``DayAlbumPagination``).

        Not ``get_queryset``: it returns no queryset, and ``retrieve`` is the
        only action this viewset serves.
        """
        album_date = self._album_date()

        photo_qs = _with_photo_summary_relations(
            album_date.photos.filter(*self._photo_filters())
            .distinct()  # Remove duplicates that can occur when filtering through reverse ForeignKey relationships (e.g., faces__person__id)
            .order_by("-exif_timestamp", "main_file__path")
        )

        photos = self.paginate_queryset(photo_qs)
        return album_date, photos or []

    def get_permissions(self) -> list[BasePermission]:
        return public_view_permissions(self.request)

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "id",
                OpenApiTypes.INT,
                OpenApiParameter.PATH,
                description="The day album's id (from /api/albums/date/list/)",
            ),
            DateAlbumFilterQuery,
            *DAY_ALBUM_PAGE_PARAMETERS,
        ],
        description=(
            "Returns the actual images, for a given day in chunks of 100 images. "
            "``results`` is the day with one page of its photos in ``items`` "
            "and their total in ``numberOfItems``; the page fields of every "
            "paginated list sit next to it."
        ),
    )
    def retrieve(self, *args: Any, **kwargs: Any) -> Response:
        album_date, photos = self._album_date_page()
        serializer = AlbumDateSerializer(
            album_date,
            context={
                "request": self.request,
                # The public view may only name places of public photos.
                "public": self._query["public"],
            },
        )
        serializer_data = serializer.data
        serializer_data["items"] = PhotoSummarySerializer(photos, many=True).data
        response = self.get_paginated_response(serializer_data)
        # The day's total, where clients have always read it (the same number
        # as the page's count).
        response.data["results"]["numberOfItems"] = response.data["count"]
        return response


# To-Do: Could be the summary command in AlbumDateViewSet
class AlbumDateListViewSet(ListViewSet):
    serializer_class = IncompleteAlbumDateSerializer
    pagination_class = None
    filter_backends = (filters.SearchFilter,)
    search_fields = [
        "photos__search_instance__search_captions",
        "photos__search_instance__search_location",
        "photos__faces__person__name",
    ]

    @cached_property
    def _query(self) -> dict[str, Any]:
        """The query string, validated once per request."""
        return parse_query(self.request, AlbumDateListQuery)

    def get_queryset(self) -> QuerySet[AlbumDate]:
        params = self._query
        filter: list[Q] = []
        filter.append(Q(photos__thumbnail__aspect_ratio__isnull=False))

        if params["hidden"]:
            filter.append(Q(photos__hidden=True))
        else:
            filter.append(Q(photos__hidden=False))

        if params["in_trashcan"]:
            filter.append(Q(photos__in_trashcan=True) & Q(photos__removed=False))
        else:
            filter.append(Q(photos__in_trashcan=False))

        # Stack filtering: Only count photos that are either:
        # 1. Not in any stack, OR
        # 2. The primary photo of their stack
        # Stacks are for organizational purposes (RAW+JPEG pairs, bursts, brackets, live photos, manual)
        # Non-primary photos are hidden in the timeline but accessible via stack expansion
        # NOTE: Duplicates are handled separately via the Duplicate model and are not filtered here
        if not params["show_all_stack_photos"]:
            # As subqueries, not LEFT JOINs: a join multiplied the rows of a
            # photo in several stacks, which is what made the count DISTINCT
            # (a sort of every row on the timeline's hottest query).
            in_no_stack = ~Exists(
                Photo.stacks.through.objects.filter(photo_id=OuterRef("pk"))
            )
            is_primary = Exists(
                PhotoStack.objects.filter(primary_photo_id=OuterRef("pk"))
            )
            filter.append(
                Q(
                    photos__in=Photo.objects.filter(in_no_stack | is_primary).values(
                        "pk"
                    )
                )
            )

        # Filter by folder path if provided
        folder_path = params["folder"]
        if folder_path:
            filter.append(folder_path_q("photos__files__path", folder_path))

        user = self.request.user
        if isinstance(user, User) and not params["public"]:
            filter.append(AlbumDate.objects.owner_q(user))
            filter.append(Photo.objects.owner_q(user, through="photos__"))

        if params["public"]:
            username = params["username"]
            if username:
                filter.append(Q(owner__username=username))
            filter.append(Q(photos__public=True))

        # Media type, screenshots, documents and favorites (see
        # api.albums.timeline_filter). Positive conditions on the photos join, applied
        # in the one filter() call below, so a day holding a screenshot keeps
        # its other photos and photo_count counts only the matching ones.
        filter += timeline_filter_q(user, params, prefix="photos__")

        if "person" in params:
            filter.append(
                Q(
                    photos__faces__person__id=params["person"],
                    photos__faces__deleted=False,
                )
            )
        last_modified = params.get("last_modified")
        if last_modified is not None and params["public"]:
            # The public view, anonymous or not, stays scoped to public photos.
            filter.append(Q(photos__last_modified__gte=last_modified))
        elif last_modified is not None:
            # For the owner it deliberately replaces every other filter. Only
            # reached signed in: get_permissions requires it unless ``public``
            # is set.
            owner = request_user(self.request)
            filter = []
            filter.append(AlbumDate.objects.owner_q(owner))
            filter.append(Photo.objects.owner_q(owner, through="photos__"))
            filter.append(Q(photos__last_modified__gte=last_modified))

        # Only these reach a photo's many files or faces, or the search fields,
        # through a join that repeats the photo; otherwise each row is one
        # day's photo and a plain count is exact.
        repeats_photos = bool(
            params["folder"] or "person" in params or params["search"]
        )
        qs = (
            AlbumDate.objects.filter(*filter)
            .annotate(photo_count=Count("photos", distinct=repeats_photos))
            .filter(Q(photo_count__gt=0))
            .order_by(F("date").desc(nulls_last=True))
        )

        return qs

    def get_permissions(self) -> list[BasePermission]:
        return public_view_permissions(self.request)

    @extend_schema(
        parameters=[AlbumDateListQuery],
        description="Gives you a list of days with the number of elements. This is not paginated and can be large.",
    )
    def list(self, *args: Any, **kwargs: Any) -> Response:
        queryset = self.get_queryset()
        public = self._query["public"]
        if public:
            # The public view may only name places of public photos.
            queryset = queryset.prefetch_related(prefetch_public_photos())
        serializer = IncompleteAlbumDateSerializer(
            queryset, many=True, context={"public": public}
        )
        return Response({"results": serializer.data})


# Create an album, or PATCH its title, photos, cover or lock. Opening one goes
# through AlbumUserViewSet.
class AlbumUserEditViewSet(
    mixins.CreateModelMixin,
    PartialUpdateModelMixin[AlbumUser],
    viewsets.GenericViewSet,
):
    permission_classes = (IsAuthenticated,)
    serializer_class = AlbumUserEditSerializer

    def get_queryset(self) -> QuerySet[AlbumUser]:
        user = self.request.user
        if not isinstance(user, User):
            return AlbumUser.objects.none()
        return AlbumUser.objects.owned_by(user).order_by("title")
