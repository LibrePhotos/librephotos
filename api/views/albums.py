import re

from django.db.models import Count, F, OuterRef, Prefetch, Q, Subquery
from rest_framework import filters, viewsets
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response

from api.models import (
    AlbumDate,
    AlbumPlace,
    AlbumThing,
    AlbumUser,
    Face,
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
from api.serializers.person import (
    AlbumPersonListSerializer,
    GroupedPersonPhotosSerializer,
    PersonSerializer,
)
from api.util import logger
from api.views.custom_api_view import ListViewSet
from api.views.pagination import (
    RegularResultsSetPagination,
    StandardResultsSetPagination,
)


# To-Do: Not used as far as I can tell
class AlbumPersonListViewSet(ListViewSet):
    serializer_class = AlbumPersonListSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        # import pdb; pdb.set_trace()
        logger.info("Logging better than pdb in prod code")

    def list(self, *args, **kwargs):
        return super(AlbumPersonListViewSet, self).list(*args, **kwargs)

# To-Do: Not used as far as I can tell, only in mobile app
class AlbumPersonViewSet(viewsets.ModelViewSet):
    def get_queryset(self):
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

    def get_queryset(self):
        qs = (
            Person.objects.filter(
                ~Q(kind=Person.KIND_CLUSTER)
                & ~Q(kind=Person.KIND_UNKNOWN)
                & Q(faces__photo__hidden=False)
                & Q(faces__photo__deleted=False)
                & Q(faces__photo__owner=self.request.user)
                & Q(
                    faces__person_label_probability__gte=F(
                        "faces__photo__owner__confidence_person"
                    )
                )
            )
            .distinct()
            .annotate(
                viewable_face_count=Count("faces"),
                face_url=Subquery(
                    Face.objects.filter(
                        person=OuterRef("pk"),
                        photo__hidden=False,
                        photo__deleted=False,
                        photo__owner=self.request.user,
                    )
                    .order_by("id") 
                    .values("image")[:1]   
                ),
                face_photo_url=Subquery(
                    Photo.objects.filter(
                        faces__person=OuterRef("pk"),
                        hidden=False,
                        deleted=False,
                        owner=self.request.user,
                    )
                    .order_by("added_on")
                    .values("image_hash")[:1]
                ),
                video=Subquery(
                    Photo.objects.filter(
                        faces__person=OuterRef("pk"),
                        hidden=False,
                        deleted=False,
                        owner=self.request.user,
                     )
                    .order_by("added_on")
                    .values("video")[:1]
                ),
            ) 
        )
        return qs

    def retrieve(self, *args, **kwargs):
        return super(PersonViewSet, self).retrieve(*args, **kwargs)

    def list(self, *args, **kwargs):
        return super(PersonViewSet, self).list(*args, **kwargs)


class AlbumThingViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumThingSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
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
class AlbumThingListViewSet(ListViewSet):
    serializer_class = AlbumThingListSerializer
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = ["title"]

    def get_queryset(self):
        return (
            AlbumThing.objects.filter(Q(owner=self.request.user))
            .annotate(
                photo_count=Count(
                    "photos", filter=Q(photos__hidden=False), distinct=True
                )
            )
            .filter(Q(photo_count__gt=0))
            .order_by("-title")
        )

    def list(self, *args, **kwargs):
        return super(AlbumThingListViewSet, self).list(*args, **kwargs)


class AlbumPlaceViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumPlaceSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
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

    def list(self, *args, **kwargs):
        return super(AlbumPlaceViewSet, self).list(*args, **kwargs)


class AlbumPlaceListViewSet(ListViewSet):
    serializer_class = AlbumPlaceListSerializer
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = ["title"]

    def get_queryset(self):
        return (
            AlbumPlace.objects.filter(owner=self.request.user)
            .annotate(
                photo_count=Count(
                    "photos", filter=Q(photos__hidden=False), distinct=True
                )
            )
            .filter(Q(photo_count__gt=0) & Q(owner=self.request.user))
            .order_by("title")
        )

    def list(self, *args, **kwargs):
        return super(AlbumPlaceListViewSet, self).list(*args, **kwargs)


class AlbumUserViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumUserSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        qs = (
            AlbumUser.objects.filter(
                Q(owner=self.request.user) | Q(shared_to__exact=self.request.user.id)
            )
            .distinct("id")
            .order_by("-id")
        )
        return qs

    def retrieve(self, *args, **kwargs):
        return super(AlbumUserViewSet, self).retrieve(*args, **kwargs)

    def list(self, *args, **kwargs):
        return super(AlbumUserViewSet, self).list(*args, **kwargs)


class AlbumUserListViewSet(ListViewSet):
    serializer_class = AlbumUserListSerializer
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = ["title"]

    def get_queryset(self):
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

    def list(self, *args, **kwargs):
        return super(AlbumUserListViewSet, self).list(*args, **kwargs)


class AlbumDateViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumDateSerializer
    pagination_class = RegularResultsSetPagination

    def get_queryset(self):
        if not self.request.user.is_anonymous:
            photo_qs = Photo.visible.filter(Q(owner=self.request.user))
            qs = AlbumDate.objects.filter(Q(owner=self.request.user)).filter(
                Q(photos__hidden=False) & Q(photos__deleted=False)
            )

        if self.request.query_params.get("favorite"):
            min_rating = self.request.user.favorite_min_rating
            qs = qs.filter(Q(photos__rating__gte=min_rating))
            photo_qs = photo_qs.filter(Q(rating__gte=min_rating))

        if self.request.query_params.get("public"):
            username = self.request.query_params.get("username")
            qs = AlbumDate.objects.filter(
                Q(owner__username=username)
                & Q(photos__hidden=False)
                & Q(photos__public=True)
            )
            photo_qs = Photo.visible.filter(
                Q(owner__username=username) & Q(public=True)
            )
        if self.request.query_params.get("deleted"):
            qs = AlbumDate.objects.filter(
                Q(owner=self.request.user) & Q(photos__deleted=True)
            )
            photo_qs = Photo.objects.filter(Q(deleted=True))

        if self.request.query_params.get("person"):
            qs = AlbumDate.objects.filter(
                Q(owner=self.request.user)
                & Q(photos__hidden=False)
                & Q(photos__faces__person__id=self.request.query_params.get("person"))
                & Q(
                    photos__faces__person_label_probability__gte=F(
                        "photos__faces__photo__owner__confidence_person"
                    )
                )
            )
            photo_qs = Photo.visible.filter(
                Q(faces__person__id=self.request.query_params.get("person"))
                & Q(
                    faces__person_label_probability__gte=F(
                        "faces__photo__owner__confidence_person"
                    )
                )
            )
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
            )
        )

        return qs

    def get_permissions(self):
        if self.request.query_params.get("public"):
            permission_classes = [AllowAny]
        else:
            permission_classes = [IsAuthenticated]
        return [permission() for permission in permission_classes]

    def retrieve(self, *args, **kwargs):
        queryset = self.get_queryset()
        albumid = re.findall(r"\'(.+?)\'", args[0].__str__())[0].split("/")[-2]
        serializer = AlbumDateSerializer(
            queryset.filter(id=albumid).first(), context={"request": self.request}
        )
        return Response({"results": serializer.data})

    def list(self, *args, **kwargs):
        return super(AlbumDateViewSet, self).list(*args, **kwargs)


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
        if not self.request.user.is_anonymous:
            qs = AlbumDate.objects.filter(
                Q(owner=self.request.user)
                & Q(photos__owner=self.request.user)
                & Q(photos__hidden=False)
                & Q(photos__aspect_ratio__isnull=False)
                & Q(photos__deleted=False)
            )
        if self.request.query_params.get("favorite"):
            min_rating = self.request.user.favorite_min_rating
            qs = AlbumDate.objects.filter(
                Q(photos__hidden=False)
                & Q(photos__aspect_ratio__isnull=False)
                & Q(photos__deleted=False)
                & Q(owner=self.request.user)
                & Q(photos__rating__gte=min_rating)
            )
        if self.request.query_params.get("public"):
            username = self.request.query_params.get("username")
            qs = AlbumDate.objects.filter(
                Q(photos__hidden=False)
                & Q(photos__aspect_ratio__isnull=False)
                & Q(photos__deleted=False)
                & Q(owner__username=username)
                & Q(photos__public=True)
            )

        if self.request.query_params.get("deleted"):
            qs = (
                AlbumDate.objects.filter(
                    Q(owner=self.request.user) & Q(photos__deleted=True)
                )
                .annotate(photo_count=Count("photos", distinct=True))
                .filter(Q(photo_count__gt=0))
                .order_by(F("date").desc(nulls_last=True))
            )
            return qs
        if self.request.query_params.get("person"):

            return (
                AlbumDate.objects.filter(
                    Q(owner=self.request.user)
                    & Q(photos__hidden=False)
                    & Q(photos__aspect_ratio__isnull=False)
                    & Q(photos__deleted=False)
                    & Q(
                        photos__faces__person__id=self.request.query_params.get(
                            "person"
                        )
                    )
                    & Q(
                        photos__faces__person_label_probability__gte=F(
                            "photos__faces__photo__owner__confidence_person"
                        )
                    )
                )
                .annotate(
                    photo_count=Count(
                        "photos",
                        filter=Q(
                            photos__faces__person__id=self.request.query_params.get(
                                "person"
                            )
                        )
                        & Q(
                            photos__faces__person_label_probability__gte=self.request.user.confidence_person
                        ),
                        distinct=True,
                    )
                )
                .filter(Q(photo_count__gt=0))
                .order_by(F("date").desc(nulls_last=True))
            )

        qs = (
            qs.annotate(
                photo_count=Count(
                    "photos", filter=Q(photos__owner=self.request.user), distinct=True
                )
            )
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

    def list(self, *args, **kwargs):
        serializer = IncompleteAlbumDateSerializer(self.get_queryset(), many=True)
        return Response({"results": serializer.data})
