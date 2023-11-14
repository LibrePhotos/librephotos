import re

from django.db.models import Count, F, Prefetch, Q
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import filters, viewsets
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from api.models import (
    AlbumDate,
    AlbumPlace,
    AlbumThing,
    AlbumUser,
    Face,
    File,
    Person,
    Photo,
    User,
)
from api.serializers.album_date import (
    AlbumDateSerializer,
    IncompleteAlbumDateSerializer,
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
from api.serializers.album_user import AlbumUserListSerializer, AlbumUserSerializer
from api.serializers.person import GroupedPersonPhotosSerializer, PersonSerializer
from api.util import logger
from api.views.custom_api_view import ListViewSet
from api.views.pagination import (
    RegularResultsSetPagination,
    StandardResultsSetPagination,
)


# To-Do: Not used as far as I can tell, only in mobile app
@extend_schema(
    deprecated=True,
    description="This endpoint is deprecated. Use /api/persons instead.",
)
class AlbumPersonViewSet(viewsets.ModelViewSet):
    serializer_class = GroupedPersonPhotosSerializer

    def get_queryset(self):
        if self.request.user.is_anonymous:
            return Person.objects.none()

        return (
            Person.objects.annotate(
                photo_count=Count(
                    "faces", filter=Q(faces__photo__hidden=False), distinct=True
                )
            )
            .filter(Q(photo_count__gt=0))
            .prefetch_related(
                Prefetch(
                    "faces",
                    queryset=Face.objects.filter(Q(person_label_is_inferred=False)),
                )
            )
            .prefetch_related(
                Prefetch(
                    "faces__photo",
                    queryset=Photo.objects.filter(
                        Q(faces__photo__hidden=False) & Q(owner=self.request.user)
                    )
                    .distinct()
                    .order_by("-exif_timestamp")
                    .only("image_hash", "exif_timestamp", "rating", "public", "hidden"),
                )
            )
        )

    def retrieve(self, *args, **kwargs):
        queryset = self.get_queryset()
        logger.warning(args[0].__str__())
        albumid = re.findall(r"\'(.+?)\'", args[0].__str__())[0].split("/")[-2]
        serializer = GroupedPersonPhotosSerializer(
            queryset.filter(id=albumid).first(), context={"request": self.request}
        )
        return Response({"results": serializer.data})

    def list(self, *args, **kwargs):
        queryset = self.get_queryset()
        serializer = GroupedPersonPhotosSerializer(
            queryset, many=True, context={"request": self.request}
        )
        return Response({"results": serializer.data})


class PersonViewSet(viewsets.ModelViewSet):
    serializer_class = PersonSerializer
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = ["name"]
    ordering_fields = ["name"]

    def get_queryset(self):
        if self.request.user.is_anonymous:
            return Person.objects.none()
        qs = (
            Person.objects.filter(
                ~Q(kind=Person.KIND_CLUSTER)
                & ~Q(kind=Person.KIND_UNKNOWN)
                & Q(cluster_owner=self.request.user)
            )
            .select_related("cover_photo")
            .only(
                "cover_photo__image_hash",
                "cover_photo__video",
                "cover_photo__faces",
                "name",
                "face_count",
                "id",
            )
        )

        return qs


class AlbumThingViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumThingSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        if self.request.user.is_anonymous:
            return AlbumThing.objects.none()
        return (
            AlbumThing.objects.filter(Q(owner=self.request.user))
            .annotate(
                photo_count=Count(
                    "photos", filter=Q(photos__hidden=False), distinct=True
                )
            )
            .filter(Q(photo_count__gt=0))
            .prefetch_related(
                Prefetch(
                    "photos",
                    queryset=Photo.visible.order_by("-exif_timestamp"),
                ),
                Prefetch(
                    "photos__owner",
                    queryset=User.objects.only(
                        "id", "username", "first_name", "last_name"
                    ),
                ),
            )
        )

    def retrieve(self, *args, **kwargs):
        queryset = self.get_queryset()
        logger.warning(args[0].__str__())
        albumid = re.findall(r"\'(.+?)\'", args[0].__str__())[0].split("/")[-2]
        serializer = GroupedThingPhotosSerializer(
            queryset.filter(id=albumid).first(), context={"request": self.request}
        )
        return Response({"results": serializer.data})

    def list(self, *args, **kwargs):
        queryset = self.get_queryset()
        serializer = GroupedThingPhotosSerializer(
            queryset, many=True, context={"request": self.request}
        )
        return Response({"results": serializer.data})


# To-Do: Make album_cover an actual database field to improve performance
# To-Do: Could be literally the list command in AlbumThingViewSet
class AlbumThingListViewSet(ListViewSet):
    serializer_class = AlbumThingListSerializer
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = ["title"]

    def get_queryset(self):
        if self.request.user.is_anonymous:
            return AlbumThing.objects.none()

        cover_photos_query = Photo.objects.filter(hidden=False).only(
            "image_hash", "video"
        )

        return (
            AlbumThing.objects.filter(owner=self.request.user)
            .annotate(photo_count=Count("photos", filter=Q(photos__hidden=False)))
            .prefetch_related(
                Prefetch(
                    "photos", queryset=cover_photos_query[:4], to_attr="cover_photos"
                )
            )
            .filter(photo_count__gt=0)
            .order_by("-title")
        )


class AlbumPlaceViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumPlaceSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        if self.request.user.is_anonymous:
            return AlbumPlace.objects.none()
        return (
            AlbumPlace.objects.annotate(
                photo_count=Count(
                    "photos", filter=Q(photos__hidden=False), distinct=True
                )
            )
            .filter(Q(photo_count__gt=0) & Q(owner=self.request.user))
            .prefetch_related(
                Prefetch(
                    "photos",
                    queryset=Photo.objects.filter(hidden=False)
                    .only("image_hash", "public", "rating", "hidden", "exif_timestamp")
                    .order_by("-exif_timestamp"),
                )
            )
        )

    def retrieve(self, *args, **kwargs):
        queryset = self.get_queryset()
        logger.warning(args[0].__str__())
        albumid = re.findall(r"\'(.+?)\'", args[0].__str__())[0].split("/")[-2]
        serializer = GroupedPlacePhotosSerializer(
            queryset.filter(id=albumid).first(), context={"request": self.request}
        )
        return Response({"results": serializer.data})


# To-Do: Could be literally the list command in AlbumPlaceViewSet
class AlbumPlaceListViewSet(ListViewSet):
    serializer_class = AlbumPlaceListSerializer
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = ["title"]

    def get_queryset(self):
        if self.request.user.is_anonymous:
            return AlbumPlace.objects.none()
        cover_photos_query = Photo.objects.filter(hidden=False).only(
            "image_hash", "video"
        )

        return (
            AlbumPlace.objects.filter(owner=self.request.user)
            .annotate(
                photo_count=Count(
                    "photos", filter=Q(photos__hidden=False), distinct=True
                )
            )
            .prefetch_related(
                Prefetch(
                    "photos", queryset=cover_photos_query[:4], to_attr="cover_photos"
                )
            )
            .filter(Q(photo_count__gt=0) & Q(owner=self.request.user))
            .order_by("title")
        )


class AlbumUserViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumUserSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        if self.request.user.is_anonymous:
            return AlbumUser.objects.none()
        qs = (
            AlbumUser.objects.filter(
                Q(owner=self.request.user) | Q(shared_to__exact=self.request.user.id)
            )
            .distinct("id")
            .order_by("-id")
        )
        return qs


# To-Do: Could be the list command in AlbumUserViewSet
class AlbumUserListViewSet(ListViewSet):
    serializer_class = AlbumUserListSerializer
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = ["title"]

    def get_queryset(self):
        if self.request.user.is_anonymous:
            return AlbumUser.objects.none()
        return (
            AlbumUser.objects.filter(owner=self.request.user)
            .annotate(
                photo_count=Count(
                    "photos", filter=Q(photos__hidden=False), distinct=True
                )
            )
            .filter(Q(photo_count__gt=0) & Q(owner=self.request.user))
            .order_by("title")
        )


class AlbumDateViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumDateSerializer
    pagination_class = RegularResultsSetPagination

    def get_queryset(self):
        albumDateFilter = []
        photoFilter = []
        photoFilter.append(Q(aspect_ratio__isnull=False))
        albumDateFilter.append(Q(photos__aspect_ratio__isnull=False))

        if not self.request.user.is_anonymous:
            photoFilter.append(Q(owner=self.request.user))
            albumDateFilter.append(Q(photos__owner=self.request.user))

        if self.request.query_params.get("favorite"):
            min_rating = self.request.user.favorite_min_rating
            albumDateFilter.append(Q(photos__rating__gte=min_rating))
            photoFilter.append(Q(rating__gte=min_rating))

        if self.request.query_params.get("public"):
            if self.request.query_params.get("username"):
                username = self.request.query_params.get("username")
                albumDateFilter.append(Q(owner__username=username))
                photoFilter.append(Q(owner__username=username))
            photoFilter.append(Q(public=True))
            albumDateFilter.append(Q(photos__public=True))

        if self.request.query_params.get("hidden"):
            albumDateFilter.append(Q(photos__hidden=True))
            photoFilter.append(Q(hidden=True))
        else:
            albumDateFilter.append(Q(photos__hidden=False))
            photoFilter.append(Q(hidden=False))

        if self.request.query_params.get("video"):
            albumDateFilter.append(Q(photos__video=True))
            photoFilter.append(Q(video=True))

        if self.request.query_params.get("photo"):
            albumDateFilter.append(Q(photos__video=False))
            photoFilter.append(Q(video=False))

        if self.request.query_params.get("deleted"):
            albumDateFilter.append(Q(photos__deleted=True))
            photoFilter.append(Q(deleted=True))
        else:
            albumDateFilter.append(Q(photos__deleted=False))
            photoFilter.append(Q(deleted=False))

        if self.request.query_params.get("person"):
            albumDateFilter.append(
                Q(photos__faces__person__id=self.request.query_params.get("person"))
            )
            albumDateFilter.append(
                Q(
                    photos__faces__person_label_probability__gte=F(
                        "photos__faces__photo__owner__confidence_person"
                    )
                )
            )
            photoFilter.append(
                Q(faces__person__id=self.request.query_params.get("person"))
            )
            photoFilter.append(
                Q(
                    faces__person_label_probability__gte=F(
                        "faces__photo__owner__confidence_person"
                    )
                )
            )

        photo_qs = Photo.objects.filter(*photoFilter)
        qs = AlbumDate.objects.filter(*albumDateFilter)

        # Todo: Make this more performant by only using the photo queryset
        # That will be a breaking change, but will improve performance
        qs = (
            qs.annotate(photo_count=Count("photos"))
            .filter(Q(photo_count__gt=0))
            .order_by("-date")
            .prefetch_related(
                Prefetch(
                    "photos",
                    queryset=photo_qs.order_by("-exif_timestamp")
                    .only(
                        "image_hash",
                        "aspect_ratio",
                        "video",
                        "main_file",
                        "search_location",
                        "dominant_color",
                        "public",
                        "rating",
                        "hidden",
                        "exif_timestamp",
                        "owner",
                        "video_length",
                    )
                    .distinct(),
                ),
                Prefetch(
                    "photos__owner",
                    queryset=User.objects.only(
                        "id", "username", "first_name", "last_name"
                    ),
                ),
                Prefetch(
                    "photos__main_file__embedded_media",
                    queryset=File.objects.only("hash"),
                ),
            )
        )

        return qs

    def get_permissions(self):
        if self.request.query_params.get("public"):
            permission_classes = [AllowAny]
        else:
            permission_classes = [IsAuthenticated]
        return [permission() for permission in permission_classes]

    @extend_schema(
        parameters=[
            OpenApiParameter("favorite", OpenApiTypes.BOOL),
            OpenApiParameter("public", OpenApiTypes.BOOL),
            OpenApiParameter("deleted", OpenApiTypes.BOOL),
            OpenApiParameter("hidden", OpenApiTypes.BOOL),
            OpenApiParameter("video", OpenApiTypes.BOOL),
            OpenApiParameter("username", OpenApiTypes.STR),
            OpenApiParameter("person", OpenApiTypes.INT),
        ],
        description="Returns the actual images, for a given day in chunks of 100 images.",
    )
    def retrieve(self, *args, **kwargs):
        queryset = self.get_queryset()
        albumid = re.findall(r"\'(.+?)\'", args[0].__str__())[0].split("/")[-2]
        serializer = AlbumDateSerializer(
            queryset.filter(id=albumid).first(), context={"request": self.request}
        )
        return Response({"results": serializer.data})


# To-Do: Could be the summary command in AlbumDateViewSet
class AlbumDateListViewSet(ListViewSet):
    serializer_class = IncompleteAlbumDateSerializer
    pagination_class = None
    filter_backends = (filters.SearchFilter,)
    search_fields = [
        "photos__search_captions",
        "photos__search_location",
        "photos__faces__person__name",
    ]

    def get_queryset(self):
        filter = []
        filter.append(Q(photos__aspect_ratio__isnull=False))

        if self.request.query_params.get("hidden"):
            filter.append(Q(photos__hidden=True))
        else:
            filter.append(Q(photos__hidden=False))

        if self.request.query_params.get("deleted"):
            filter.append(Q(photos__deleted=True))
        else:
            filter.append(Q(photos__deleted=False))

        if not self.request.user.is_anonymous:
            filter.append(Q(owner=self.request.user))
            filter.append(Q(photos__owner=self.request.user))

        if self.request.query_params.get("favorite"):
            min_rating = self.request.user.favorite_min_rating
            filter.append(Q(photos__rating__gte=min_rating))

        if self.request.query_params.get("public"):
            username = self.request.query_params.get("username")
            filter.append(Q(owner__username=username))
            filter.append(Q(photos__public=True))

        if self.request.query_params.get("video"):
            filter.append(Q(photos__video=True))

        if self.request.query_params.get("photo"):
            filter.append(Q(photos__video=False))

        if self.request.query_params.get("person"):
            filter.append(
                Q(photos__faces__person__id=self.request.query_params.get("person"))
            )
            filter.append(
                Q(
                    photos__faces__person_label_probability__gte=F(
                        "photos__faces__photo__owner__confidence_person"
                    )
                )
            )

        qs = (
            AlbumDate.objects.filter(*filter)
            .annotate(photo_count=Count("photos", distinct=True))
            .filter(Q(photo_count__gt=0))
            .order_by(F("date").desc(nulls_last=True))
        )

        return qs

    def get_permissions(self):
        if self.request.query_params.get("public"):
            permission_classes = [AllowAny]
        else:
            permission_classes = [IsAuthenticated]
        return [permission() for permission in permission_classes]

    @extend_schema(
        parameters=[
            OpenApiParameter("favorite", OpenApiTypes.BOOL),
            OpenApiParameter("public", OpenApiTypes.BOOL),
            OpenApiParameter("deleted", OpenApiTypes.BOOL),
            OpenApiParameter("hidden", OpenApiTypes.BOOL),
            OpenApiParameter("video", OpenApiTypes.BOOL),
            OpenApiParameter("username", OpenApiTypes.STR),
            OpenApiParameter("person", OpenApiTypes.INT),
        ],
        description="Gives you a list of days with the number of elements. This is not paginated and can be large.",
    )
    def list(self, *args, **kwargs):
        serializer = IncompleteAlbumDateSerializer(self.get_queryset(), many=True)
        return Response({"results": serializer.data})
