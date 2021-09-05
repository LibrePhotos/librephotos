import re

import six
from django.db.models import Count, Prefetch, Q
from rest_framework import filters, viewsets
from rest_framework.response import Response
from rest_framework_extensions.cache.decorators import cache_response

from api.drf_optimize import OptimizeRelatedModelViewSetMetaclass
from api.models import AlbumAuto, AlbumPlace, AlbumThing, AlbumUser, Face, Person, Photo
from api.util import logger
from api.views.caching import (
    CACHE_TTL,
    CustomListKeyConstructor,
    CustomObjectKeyConstructor,
)
from api.views.pagination import StandardResultsSetPagination
from api.views.serializers import (
    AlbumAutoListSerializer,
    AlbumAutoSerializer,
    AlbumPersonListSerializer,
    AlbumPlaceListSerializer,
    AlbumPlaceSerializer,
    AlbumThingListSerializer,
    AlbumThingSerializer,
    AlbumUserListSerializer,
    PersonSerializer,
)
from api.views.serializers_serpy import (
    AlbumUserSerializerSerpy,
    GroupedPersonPhotosSerializer,
    GroupedPlacePhotosSerializer,
)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumAutoViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumAutoSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        return (
            AlbumAuto.objects.annotate(
                photo_count=Count(
                    "photos", filter=Q(photos__hidden=False), distinct=True
                )
            )
            .filter(Q(photo_count__gt=0) & Q(owner=self.request.user))
            .prefetch_related(
                Prefetch(
                    "photos",
                    queryset=Photo.objects.filter(hidden=False).only(
                        "image_hash", "public", "rating", "hidden", "exif_timestamp"
                    ),
                )
            )
            .only("id", "title", "timestamp", "created_on", "gps_lat", "gps_lon")
            .order_by("-timestamp")
        )

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumAutoViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumAutoViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
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
            .prefetch_related(
                Prefetch(
                    "photos",
                    queryset=Photo.objects.filter(hidden=False).only(
                        "image_hash",
                        "shared_to",
                        "public",
                        "exif_timestamp",
                        "rating",
                        "hidden",
                    ),
                )
            )
            .only("id", "title", "timestamp", "shared_to")
            .order_by("-timestamp")
        )

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumAutoListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumAutoListViewSet, self).list(*args, **kwargs)


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


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
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

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        queryset = self.get_queryset()
        logger.warning(args[0].__str__())
        albumid = re.findall(r"\'(.+?)\'", args[0].__str__())[0].split("/")[-2]
        serializer = GroupedPersonPhotosSerializer(queryset.filter(id=albumid).first())
        serializer.context = {"request": self.request}
        return Response({"results": serializer.data})

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        queryset = self.get_queryset()
        serializer = GroupedPersonPhotosSerializer(queryset, many=True)
        serializer.context = {"request": self.request}
        return Response({"results": serializer.data})


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class PersonViewSet(viewsets.ModelViewSet):
    serializer_class = PersonSerializer
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = ["name"]

    def get_queryset(self):
        qs = (
            Person.objects.filter(
                Q(faces__photo__hidden=False)
                & Q(faces__photo__owner=self.request.user)
                & Q(faces__person_label_is_inferred=False)
            )
            .distinct()
            .annotate(viewable_face_count=Count("faces"))
            .filter(Q(viewable_face_count__gt=0))
            .order_by("name")
        )
        return qs

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(PersonViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
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
            .order_by("title")
        )

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumThingViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumThingViewSet, self).list(*args, **kwargs)


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
            .prefetch_related(
                Prefetch("photos", queryset=Photo.visible.only("image_hash", "video"))
            )
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
            .order_by("title")
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
            .order_by("-title")
            .prefetch_related(
                Prefetch("photos", queryset=Photo.visible.only("image_hash"))
            )
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

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumUserViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumUserViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
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
            .order_by("-created_on")
            .prefetch_related(
                Prefetch("photos", queryset=Photo.visible.only("image_hash"))
            )
        )

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumUserListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumUserListViewSet, self).list(*args, **kwargs)
