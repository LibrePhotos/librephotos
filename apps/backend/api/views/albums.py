import logging
from typing import Any

from django.db.models import Count, Exists, OuterRef, Prefetch, Q, QuerySet, Subquery
from drf_spectacular.utils import (
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
from api.drf.pagination import (
    DefaultPagination,
    WholeListPagination,
)
from api.drf.params import parse_body, parse_query
from api.drf.request_user import request_user
from api.faces.groups import set_person_groups
from api.faces.labels import relabel_faces
from api.faces.merge import merge_people
from api.models import (
    AlbumCollection,
    AlbumPlace,
    AlbumThing,
    AlbumUser,
    Face,
    Person,
    Photo,
    User,
)
from api.models.photo import visible_photo_q
from api.serializers.album_collection import (
    UserAlbumCollectionsRequest,
    UserAlbumCollectionsSerializer,
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
from api.serializers.days import PublicViewQuery
from api.serializers.person import (
    PersonListQuery,
    PersonMergeRequest,
    PersonMergeResponseSerializer,
    PersonRemovePhotosRequest,
    PersonRemovePhotosResponseSerializer,
    PersonSerializer,
    first_face_of_person,
    person_groups_prefetch,
)
from api.serializers.person_group import PersonGroupsRequest, PersonGroupsSerializer
from api.serializers.photos import (
    # Kept under its old name for the views that import it from here.
    with_photo_summary_relations as _with_photo_summary_relations,
)
from api.views.custom_api_view import CoverPhotosMixin, ListViewSet
from api.views.mixins import PartialUpdateModelMixin

logger = logging.getLogger(__name__)


@extend_schema_view(list=extend_schema(parameters=[PersonListQuery]))
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
                "birth_date",
            )
            .annotate(
                first_face_image=Subquery(first_face.values("image")[:1]),
                first_face_photo_hash=Subquery(
                    first_face.values("photo__image_hash")[:1]
                ),
                first_face_photo_video=Subquery(first_face.values("photo__video")[:1]),
            )
            .prefetch_related(person_groups_prefetch())
            .order_by("name")
        )
        if self.action == "list":
            group = parse_query(self.request, PersonListQuery).get("group")
            if group is not None:
                qs = qs.in_group(user, group)
        return qs

    @extend_schema(
        description=(
            "Put the person in exactly the listed groups of the requester "
            "(#1126); a group left out loses them."
        ),
        request=PersonGroupsRequest,
        responses={200: PersonGroupsSerializer},
    )
    @action(detail=True, methods=["put"], url_path="groups")
    def groups(self, request: Request, pk: str | None = None) -> Response:
        person = self.get_object()
        chosen = parse_body(request, PersonGroupsRequest)["group_ids"]
        return Response({"group_ids": set_person_groups(person, chosen)})

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
class AlbumThingListViewSet(CoverPhotosMixin[AlbumThing], ListViewSet):
    permission_classes = (IsAuthenticated,)
    serializer_class = AlbumThingListSerializer
    pagination_class = WholeListPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = ["title"]
    # The card shows the stored photo_count. The covers come from the
    # album's visible photos, as on the place list: the stored cover_photos
    # are never replaced once hidden or trashed, so an album could be listed
    # with none of them left (#2234).
    cover_photos_attr = "visible_cover_photos"

    def get_queryset(self) -> QuerySet[AlbumThing]:
        user = self.request.user
        if not isinstance(user, User):
            return AlbumThing.objects.none()

        active_types = _get_active_tag_thing_types()
        queryset = (
            AlbumThing.objects.owned_by(user)
            .filter(_thing_has_visible_photo())
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
class AlbumPlaceListViewSet(CoverPhotosMixin[AlbumPlace], ListViewSet):
    permission_classes = (IsAuthenticated,)
    serializer_class = AlbumPlaceListSerializer
    pagination_class = DefaultPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = ["title"]

    def get_queryset(self) -> QuerySet[AlbumPlace]:
        user = self.request.user
        if not isinstance(user, User):
            return AlbumPlace.objects.none()

        return (
            AlbumPlace.objects.owned_by(user)
            # No DISTINCT: a place holds a photo once and the thumbnail join is
            # one-to-one, and COUNT(DISTINCT) sorted every place link.
            .annotate(photo_count=Count("photos", filter=visible_photo_q("photos__")))
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
            # Anyone holding an album's active public link: its slug, never
            # the album's id alone, which counts up and would list them all.
            query = parse_query(self.request, AlbumUserQuery)
            username = query["username"]
            from django.utils import timezone

            if not query["slug"]:
                return AlbumUser.objects.none()
            base_qs = AlbumUser.objects.filter(
                Q(share__enabled=True)
                & Q(share__slug=query["slug"])
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
