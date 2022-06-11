import datetime
import re

import six
from django.db.models import Count, F, Prefetch, Q
from rest_framework import filters, viewsets
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework_extensions.cache.decorators import cache_response

from api.drf_optimize import OptimizeRelatedModelViewSetMetaclass
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
from api.serializers.album_user import AlbumUserListSerializer, AlbumUserSerializerSerpy
from api.serializers.serializers import (
    AlbumPersonListSerializer,
    AlbumPlaceListSerializer,
    AlbumPlaceSerializer,
    AlbumThingListSerializer,
    AlbumThingSerializer,
    PersonSerializer,
)
from api.serializers.serializers_serpy import (
    GroupedPersonPhotosSerializer,
    GroupedPlacePhotosSerializer,
    GroupedThingPhotosSerializer,
    PigAlbumDateSerializer,
    PigIncompleteAlbumDateSerializer,
)
from api.util import logger
from api.views.caching import (
    CACHE_TTL,
    CustomListKeyConstructor,
    CustomObjectKeyConstructor,
)
from api.views.pagination import (
    RegularResultsSetPagination,
    StandardResultsSetPagination,
)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumPersonListViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumPersonListSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        # import pdb; pdb.set_trace()
        logger.info("Logging better than pdb in prod code")

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumPersonListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumPersonListViewSet, self).list(*args, **kwargs)


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
        serializer = GroupedPersonPhotosSerializer(queryset.filter(id=albumid).first())
        serializer.context = {"request": self.request}
        return Response({"results": serializer.data})

    def list(self, *args, **kwargs):
        queryset = self.get_queryset()
        serializer = GroupedPersonPhotosSerializer(queryset, many=True)
        serializer.context = {"request": self.request}
        return Response({"results": serializer.data})


class PersonViewSet(viewsets.ModelViewSet):
    serializer_class = PersonSerializer
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = ["name"]

    def get_queryset(self):
        qs = (
            Person.objects.filter(
                Q(faces__photo__hidden=False)
                & Q(faces__photo__deleted=False)
                & Q(faces__photo__owner=self.request.user)
                & Q(faces__person_label_is_inferred=False)
            )
            .distinct()
            .annotate(viewable_face_count=Count("faces"))
            .filter(Q(viewable_face_count__gt=0))
            .order_by("name")
        )
        return qs

    def retrieve(self, *args, **kwargs):
        return super(PersonViewSet, self).retrieve(*args, **kwargs)

    def list(self, *args, **kwargs):
        return super(PersonViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumThingViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumThingSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        return (
            AlbumThing.objects.filter(
                Q(owner=self.request.user) & Q(photos__hidden=False)
            )
            .annotate(photo_count=Count("photos"))
            .filter(Q(photo_count__gt=0))
            .prefetch_related(
                Prefetch(
                    "photos",
                    queryset=Photo.objects.filter(hidden=False)
                    .only("image_hash", "public", "rating", "hidden", "exif_timestamp")
                    .order_by("-exif_timestamp"),
                )
            )
        )

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        queryset = self.get_queryset()
        logger.warning(args[0].__str__())
        albumid = re.findall(r"\'(.+?)\'", args[0].__str__())[0].split("/")[-2]
        serializer = GroupedThingPhotosSerializer(queryset.filter(id=albumid).first())
        serializer.context = {"request": self.request}
        return Response({"results": serializer.data})

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        queryset = self.get_queryset()
        serializer = GroupedThingPhotosSerializer(queryset, many=True)
        serializer.context = {"request": self.request}
        return Response({"results": serializer.data})


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumThingListViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumThingListSerializer
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = ["title"]

    def get_queryset(self):
        return (
            AlbumThing.objects.filter(
                Q(owner=self.request.user) & Q(photos__hidden=False)
            )
            .annotate(photo_count=Count("photos"))
            .filter(Q(photo_count__gt=0))
            .order_by("-title")
        )

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumThingListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumThingListViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
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

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        queryset = self.get_queryset()
        logger.warning(args[0].__str__())
        albumid = re.findall(r"\'(.+?)\'", args[0].__str__())[0].split("/")[-2]
        serializer = GroupedPlacePhotosSerializer(queryset.filter(id=albumid).first())
        serializer.context = {"request": self.request}
        return Response({"results": serializer.data})

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumPlaceViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumPlaceListViewSet(viewsets.ModelViewSet):
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

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumPlaceListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumPlaceListViewSet, self).list(*args, **kwargs)


class AlbumUserViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumUserSerializerSerpy
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


class AlbumUserListViewSet(viewsets.ModelViewSet):
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

    def retrieve(self, *args, **kwargs):
        return super(AlbumUserListViewSet, self).retrieve(*args, **kwargs)

    def list(self, *args, **kwargs):
        return super(AlbumUserListViewSet, self).list(*args, **kwargs)


class AlbumDateViewSet(viewsets.ModelViewSet):
    serializer_class = PigAlbumDateSerializer
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
                & Q(photos__faces__person_label_is_inferred=False)
            )
            photo_qs = Photo.visible.filter(
                Q(faces__person__id=self.request.query_params.get("person"))
                & Q(faces__person_label_is_inferred=False)
            )

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
        serializer = PigAlbumDateSerializer(queryset.filter(id=albumid).first())
        serializer.context = {"request": self.request}
        return Response({"results": serializer.data})

    def list(self, *args, **kwargs):
        return super(AlbumDateViewSet, self).list(*args, **kwargs)


class AlbumDateListViewSet(viewsets.ModelViewSet):
    serializer_class = PigIncompleteAlbumDateSerializer
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = [
        "photos__search_captions",
        "photos__search_location",
        "photos__faces__person__name",
    ]

    def get_queryset(self):
        if not self.request.user.is_anonymous:
            qs = AlbumDate.visible.filter(Q(owner=self.request.user))
        if self.request.query_params.get("favorite"):
            min_rating = self.request.user.favorite_min_rating
            qs = AlbumDate.visible.filter(
                Q(owner=self.request.user) & Q(photos__rating__gte=min_rating)
            )
        if self.request.query_params.get("public"):
            username = self.request.query_params.get("username")
            qs = AlbumDate.visible.filter(
                Q(owner__username=username) & Q(photos__public=True)
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
                AlbumDate.visible.filter(
                    Q(owner=self.request.user)
                    & Q(
                        photos__faces__person__id=self.request.query_params.get(
                            "person"
                        )
                    )
                    & Q(photos__faces__person_label_is_inferred=False)
                )
                .prefetch_related(
                    Prefetch(
                        "photos",
                        queryset=Photo.visible.filter(
                            Q(faces__person__id=self.request.query_params.get("person"))
                            & Q(faces__person_label_is_inferred=False)
                        )
                        .order_by("-exif_timestamp")
                        .only(
                            "image_hash",
                        )
                        .distinct(),
                    ),
                )
                .annotate(photo_count=Count("photos", distinct=True))
                .filter(Q(photo_count__gt=0))
                .order_by(F("date").desc(nulls_last=True))
            )

        qs = (
            qs.annotate(photo_count=Count("photos", distinct=True))
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

    def retrieve(self, *args, **kwargs):
        return super(AlbumDateListViewSet, self).retrieve(*args, **kwargs)

    def list(self, *args, **kwargs):
        start = datetime.datetime.now()
        res = super(AlbumDateListViewSet, self).list(*args, **kwargs)
        elapsed = (datetime.datetime.now() - start).total_seconds()
        logger.info("querying & serializing took %.2f seconds" % elapsed)
        return res
