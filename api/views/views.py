import datetime
import io
import os
import subprocess
import uuid
import zipfile

import django_rq
import magic
import six
from constance import config as site_config
from django.core.cache import cache
from django.db.models import Count, Prefetch, Q
from django.http import HttpResponse, HttpResponseForbidden, StreamingHttpResponse
from django.utils.encoding import iri_to_uri
from rest_framework import filters, viewsets
from rest_framework.permissions import AllowAny, IsAdminUser, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_extensions.cache.decorators import cache_response
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken

import ownphotos.settings
from api.api_util import (
    get_count_stats,
    get_location_clusters,
    get_location_sunburst,
    get_location_timeline,
    get_photo_month_counts,
    get_search_term_examples,
    get_searchterms_wordcloud,
    path_to_dict,
)
from api.autoalbum import delete_missing_photos
from api.date_time_extractor import DEFAULT_RULES_JSON, PREDEFINED_RULES_JSON
from api.directory_watcher import scan_faces, scan_photos
from api.drf_optimize import OptimizeRelatedModelViewSetMetaclass
from api.face_classify import cluster_faces, train_faces
from api.models import (
    AlbumAuto,
    AlbumDate,
    AlbumUser,
    Face,
    LongRunningJob,
    Photo,
    User,
    user,
)
from api.models.person import get_or_create_person
from api.permissions import (
    IsOwnerOrReadOnly,
    IsPhotoOrAlbumSharedTo,
    IsRegistrationAllowed,
    IsUserOrReadOnly,
)
from api.social_graph import build_social_graph
from api.util import logger
from api.views.caching import (
    CACHE_TTL,
    CustomListKeyConstructor,
    CustomObjectKeyConstructor,
)
from api.views.pagination import (
    HugeResultsSetPagination,
    StandardResultsSetPagination,
    TinyResultsSetPagination,
)
from api.views.serializers import (
    AlbumAutoListSerializer,
    AlbumUserEditSerializer,
    AlbumUserListSerializer,
    FaceListSerializer,
    FaceSerializer,
    LongRunningJobSerializer,
    ManageUserSerializer,
    PhotoEditSerializer,
    PhotoHashListSerializer,
    PhotoSerializer,
    PhotoSimpleSerializer,
    PhotoSuperSimpleSerializer,
    SharedFromMePhotoThroughSerializer,
    UserSerializer,
)
from api.views.serializers_serpy import (
    PhotoSuperSimpleSerializer as PhotoSuperSimpleSerializerSerpy,
)
from api.views.serializers_serpy import PigAlbumDateSerializer, PigPhotoSerilizer
from api.views.serializers_serpy import (
    SharedPhotoSuperSimpleSerializer as SharedPhotoSuperSimpleSerializerSerpy,
)


def queue_can_accept_job():
    default_queue_stat = [
        q for q in django_rq.utils.get_statistics()["queues"] if q["name"] == "default"
    ][0]
    started_jobs = default_queue_stat["started_jobs"]
    runninb_jobs = default_queue_stat["jobs"]
    if started_jobs + runninb_jobs > 0:
        return False
    else:
        return True


class PhotoViewSet(viewsets.ModelViewSet):
    serializer_class = PhotoSerializer
    pagination_class = HugeResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = [
        "search_captions",
        "search_location",
        "faces__person__name",
        "exif_timestamp",
        "image_paths",
    ]

    def get_permissions(self):
        if self.action == "list" or self.action == "retrieve":
            permission_classes = [IsPhotoOrAlbumSharedTo]
        else:
            permission_classes = [IsAdminUser or IsOwnerOrReadOnly]
        return [permission() for permission in permission_classes]

    def get_queryset(self):
        if self.request.user.is_anonymous:
            return Photo.visible.filter(Q(public=True)).order_by("-exif_timestamp")
        else:
            return Photo.objects.order_by("-exif_timestamp")

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(PhotoViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(PhotoViewSet, self).list(*args, **kwargs)


class PhotoEditViewSet(viewsets.ModelViewSet):
    serializer_class = PhotoEditSerializer
    pagination_class = StandardResultsSetPagination

    def get_queryset(self):
        return Photo.visible.filter(Q(owner=self.request.user))

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(PhotoEditViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(PhotoEditViewSet, self).list(*args, **kwargs)


class PhotoHashListViewSet(viewsets.ModelViewSet):
    serializer_class = PhotoHashListSerializer
    pagination_class = HugeResultsSetPagination
    permission_classes = (IsAuthenticated,)
    filter_backends = (filters.SearchFilter,)
    search_fields = [
        "search_captions",
        "search_location",
        "faces__person__name",
        "exif_timestamp",
        "image_paths",
    ]

    def get_queryset(self):
        return Photo.visible.filter(Q(owner=self.request.user)).order_by(
            "-exif_timestamp"
        )

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(PhotoHashListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(PhotoHashListViewSet, self).list(*args, **kwargs)


class PhotoSimpleListViewSet(viewsets.ModelViewSet):
    serializer_class = PhotoSimpleSerializer
    pagination_class = HugeResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = [
        "search_captions",
        "search_location",
        "faces__person__name",
        "exif_timestamp",
        "image_paths",
    ]

    def get_queryset(self):
        return Photo.visible.filter(Q(owner=self.request.user)).order_by(
            "-exif_timestamp"
        )

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(PhotoSimpleListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(PhotoSimpleListViewSet, self).list(*args, **kwargs)


class PhotoSuperSimpleListViewSet(viewsets.ModelViewSet):

    queryset = Photo.visible.order_by("-exif_timestamp")
    serializer_class = PhotoSuperSimpleSerializerSerpy
    pagination_class = HugeResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    search_fields = [
        "search_captions",
        "search_location",
        "faces__person__name",
        "exif_timestamp",
        "image_paths",
    ]

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(PhotoSuperSimpleListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, request):
        queryset = Photo.visible.only(
            "image_hash", "exif_timestamp", "rating", "public", "hidden"
        ).order_by("exif_timestamp")
        serializer = PhotoSuperSimpleSerializer(queryset, many=True)
        return Response({"results": serializer.data})


class SharedToMePhotoSuperSimpleListViewSet(viewsets.ModelViewSet):

    serializer_class = PigPhotoSerilizer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return (
            Photo.visible.filter(Q(shared_to__id__exact=self.request.user.id))
            .only(
                "image_hash",
                "public",
                "rating",
                "owner",
                "hidden",
                "exif_timestamp",
            )
            .prefetch_related("owner")
            .order_by("exif_timestamp")
        )


class SharedFromMePhotoSuperSimpleListViewSet(viewsets.ModelViewSet):

    serializer_class = SharedPhotoSuperSimpleSerializerSerpy
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        qs = (
            Photo.objects.filter(hidden=False)
            .prefetch_related("owner")
            .prefetch_related(
                Prefetch(
                    "shared_to",
                    queryset=User.objects.only(
                        "id", "username", "first_name", "last_name"
                    ),
                )
            )
            .annotate(shared_to_count=Count("shared_to"))
            .filter(shared_to_count__gt=0)
            .filter(owner=self.request.user.id)
            .only(
                "image_hash",
                "rating",
                "hidden",
                "exif_timestamp",
                "public",
                "shared_to",
                "owner",
            )
            .distinct()
            .order_by("exif_timestamp")
        )
        return qs


class SharedFromMePhotoSuperSimpleListViewSet2(viewsets.ModelViewSet):

    serializer_class = SharedFromMePhotoThroughSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        ThroughModel = Photo.shared_to.through

        user_photos = Photo.visible.filter(Q(owner=self.request.user.id)).only(
            "image_hash"
        )
        qs = (
            ThroughModel.objects.filter(photo_id__in=user_photos)
            .prefetch_related(
                Prefetch(
                    "user",
                    queryset=User.objects.only(
                        "id", "username", "first_name", "last_name"
                    ),
                )
            )
            .prefetch_related(
                Prefetch(
                    "photo",
                    queryset=Photo.objects.filter(hidden=False).only(
                        "image_hash", "rating", "hidden", "exif_timestamp", "public"
                    ),
                )
            )
            .order_by("photo__exif_timestamp")
        )
        return qs


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class FaceListViewSet(viewsets.ModelViewSet):
    serializer_class = FaceListSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(FaceListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(FaceListViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class FaceInferredListViewSet(viewsets.ModelViewSet):
    serializer_class = FaceListSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        # Todo: optimze query by only prefetching relevant models & fields
        queryset = (
            Face.objects.filter(
                Q(photo__hidden=False)
                & Q(photo__owner=self.request.user)
                & Q(person_label_is_inferred=True)
            )
            .select_related("person")
            .order_by("id")
        )
        return queryset

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(FaceInferredListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(FaceInferredListViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class FaceLabeledListViewSet(viewsets.ModelViewSet):
    serializer_class = FaceListSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        # Todo: optimze query by only prefetching relevant models & fields
        queryset = (
            Face.objects.filter(
                Q(photo__hidden=False) & Q(photo__owner=self.request.user),
                Q(person_label_is_inferred=False) | Q(person__name="unknown"),
            )
            .select_related("person")
            .order_by("id")
        )
        return queryset

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(FaceLabeledListViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(FaceLabeledListViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class FaceViewSet(viewsets.ModelViewSet):
    queryset = (
        Face.objects.filter(Q(photo__hidden=False))
        .prefetch_related("person")
        .order_by("id")
    )
    serializer_class = FaceSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(FaceViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(FaceViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class FaceInferredViewSet(viewsets.ModelViewSet):
    serializer_class = FaceSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return Face.objects.filter(
            Q(photo__hidden=False)
            & Q(photo__owner=self.request.user)
            & Q(person_label_is_inferred=True)
        ).order_by("id")

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(FaceInferredViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(FaceInferredViewSet, self).list(*args, **kwargs)


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class FaceLabeledViewSet(viewsets.ModelViewSet):
    serializer_class = FaceSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return Face.objects.filter(
            Q(photo__hidden=False)
            & Q(photo__owner=self.request.user)
            & Q(person_label_is_inferred=False)
        ).order_by("id")

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(FaceLabeledViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(FaceLabeledViewSet, self).list(*args, **kwargs)


class SharedToMeAlbumAutoListViewSet(viewsets.ModelViewSet):

    serializer_class = AlbumAutoListSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return (
            AlbumAuto.objects.annotate(
                photo_count=Count(
                    "photos", filter=Q(photos__hidden=False), distinct=True
                )
            )
            .filter(Q(photo_count__gt=0) & Q(shared_to__id__exact=self.request.user.id))
            .filter(owner=self.request.user)
            .prefetch_related("photos")
            .order_by("-timestamp")
        )


class SharedFromMeAlbumAutoListViewSet(viewsets.ModelViewSet):

    serializer_class = AlbumAutoListSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return (
            AlbumAuto.objects.annotate(
                photo_count=Count(
                    "photos", filter=Q(photos__hidden=False), distinct=True
                )
            )
            .filter(Q(photo_count__gt=0) & Q(owner=self.request.user))
            .prefetch_related("photos")
            .order_by("-timestamp")
            .annotate(shared_to_count=Count("shared_to"))
            .filter(shared_to_count__gt=0)
            .filter(owner=self.request.user.id)
        )


class AlbumDateListWithPhotoHashViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = PigAlbumDateSerializer
    pagination_class = StandardResultsSetPagination
    filter_backends = (filters.SearchFilter,)
    ordering_fields = ("photos__exif_timestamp",)
    search_fields = [
        "photos__search_captions",
        "photos__search_location",
        "photos__faces__person__name",
    ]

    def get_queryset(self):
        qs = (
            AlbumDate.objects.filter(
                Q(owner=self.request.user) & Q(photos__hidden=False)
            )
            .exclude(date=None)
            .annotate(photo_count=Count("photos"))
            .filter(Q(photo_count__gt=0))
            .order_by("-date")
            .prefetch_related(
                Prefetch(
                    "photos",
                    queryset=Photo.visible.filter(Q(owner=self.request.user))
                    .order_by("-exif_timestamp")
                    .only("image_hash", "public", "exif_timestamp", "rating", "hidden"),
                )
            )
        )
        return qs

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumDateListWithPhotoHashViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        start = datetime.datetime.now()
        res = super(AlbumDateListWithPhotoHashViewSet, self).list(*args, **kwargs)
        elapsed = (datetime.datetime.now() - start).total_seconds()
        logger.info("querying & serializing took %.2f seconds" % elapsed)
        return res


@six.add_metaclass(OptimizeRelatedModelViewSetMetaclass)
class AlbumUserEditViewSet(viewsets.ModelViewSet):
    serializer_class = AlbumUserEditSerializer
    pagination_class = StandardResultsSetPagination

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(AlbumUserEditViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(AlbumUserEditViewSet, self).list(*args, **kwargs)

    def get_queryset(self):
        return AlbumUser.objects.filter(owner=self.request.user).order_by("title")


class SharedToMeAlbumUserListViewSet(viewsets.ModelViewSet):

    serializer_class = AlbumUserListSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return AlbumUser.objects.filter(shared_to__id__exact=self.request.user.id)


class SharedFromMeAlbumUserListViewSet(viewsets.ModelViewSet):

    serializer_class = AlbumUserListSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return (
            AlbumUser.objects.annotate(shared_to_count=Count("shared_to"))
            .filter(shared_to_count__gt=0)
            .filter(owner=self.request.user.id)
        )


class SharedFromMeAlbumUserListViewSet2(viewsets.ModelViewSet):

    serializer_class = AlbumUserListSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return (
            AlbumUser.objects.annotate(shared_to_count=Count("shared_to"))
            .filter(shared_to_count__gt=0)
            .filter(owner=self.request.user.id)
        )


class LongRunningJobViewSet(viewsets.ModelViewSet):
    queryset = LongRunningJob.objects.all().order_by("-started_at")
    serializer_class = LongRunningJobSerializer
    pagination_class = TinyResultsSetPagination


class UserViewSet(viewsets.ModelViewSet):

    serializer_class = UserSerializer

    permission_classes = (IsUserOrReadOnly,)

    def get_queryset(self):
        queryset = User.objects.only(
            "id",
            "username",
            "email",
            "scan_directory",
            "transcode_videos",
            "confidence",
            "semantic_search_topk",
            "first_name",
            "last_name",
            "date_joined",
            "avatar",
            "nextcloud_server_address",
            "nextcloud_username",
            "nextcloud_scan_directory",
            "favorite_min_rating",
            "image_scale",
            "save_metadata_to_disk",
        ).order_by("-last_login")
        return queryset

    def get_permissions(self):
        if self.action == "create":
            self.permission_classes = (IsRegistrationAllowed,)
            cache.clear()
        elif self.action == "list":
            self.permission_classes = (AllowAny,)
        elif self.request.method == "GET" or self.request.method == "POST":
            self.permission_classes = (AllowAny,)
        else:
            self.permission_classes = (IsUserOrReadOnly,)
        return super(UserViewSet, self).get_permissions()

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(UserViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(UserViewSet, self).list(*args, **kwargs)


class ManageUserViewSet(viewsets.ModelViewSet):
    queryset = User.objects.all().order_by("-last_login")
    serializer_class = ManageUserSerializer
    permission_classes = (IsAdminUser,)

    @cache_response(CACHE_TTL, key_func=CustomObjectKeyConstructor())
    def retrieve(self, *args, **kwargs):
        return super(ManageUserViewSet, self).retrieve(*args, **kwargs)

    @cache_response(CACHE_TTL, key_func=CustomListKeyConstructor())
    def list(self, *args, **kwargs):
        return super(ManageUserViewSet, self).list(*args, **kwargs)


# API Views

# Views that do things I don't know how to make serializers do

# todo: set limit on number of photos to set public/shared/favorite/hidden at once?
class SiteSettingsView(APIView):
    def get_permissions(self):
        if self.request.method == "GET":
            self.permission_classes = (AllowAny,)
        else:
            self.permission_classes = (IsAdminUser,)

        return super(SiteSettingsView, self).get_permissions()

    def get(self, request, format=None):
        out = {}
        out["allow_registration"] = site_config.ALLOW_REGISTRATION
        return Response(out)

    def post(self, request, format=None):
        if "allow_registration" in request.data.keys():
            site_config.ALLOW_REGISTRATION = request.data["allow_registration"]

        return self.get(request, format=format)


class SetUserAlbumShared(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        # print(data)
        shared = data["shared"]  # bool
        target_user_id = data["target_user_id"]  # user pk, int
        user_album_id = data["album_id"]

        try:
            target_user = User.objects.get(id=target_user_id)
        except User.DoesNotExist:
            logger.warning(
                "Cannot share album to user: target user_id {} does not exist".format(
                    target_user_id
                )
            )
            return Response(
                {"status": False, "message": "No such user"}, status_code=400
            )

        try:
            user_album_to_share = AlbumUser.objects.get(id=user_album_id)
        except AlbumUser.DoesNotExist:
            logger.warning(
                "Cannot share album to user: source user_album_id {} does not exist".format(
                    user_album_id
                )
            )
            return Response(
                {"status": False, "message": "No such album"}, status_code=400
            )

        if user_album_to_share.owner != request.user:
            logger.warning(
                "Cannot share album to user: source user_album_id {} does not belong to user_id {}".format(
                    user_album_id, request.user.id
                )
            )
            return Response(
                {"status": False, "message": "You cannot share an album you don't own"},
                status_code=400,
            )

        if shared:
            user_album_to_share.shared_to.add(target_user)
            logger.info(
                "Shared user {}'s album {} to user {}".format(
                    request.user.id, user_album_id, target_user_id
                )
            )
        else:
            user_album_to_share.shared_to.remove(target_user)
            logger.info(
                "Unshared user {}'s album {} to user {}".format(
                    request.user.id, user_album_id, target_user_id
                )
            )

        user_album_to_share.save()
        cache.clear()
        return Response(AlbumUserListSerializer(user_album_to_share).data)


class GeneratePhotoCaption(APIView):
    permission_classes = (IsOwnerOrReadOnly,)

    def post(self, request, format=None):
        data = dict(request.data)
        image_hash = data["image_hash"]

        photo = Photo.objects.get(image_hash=image_hash)
        if photo.owner != request.user:
            return Response(
                {"status": False, "message": "you are not the owner of this photo"},
                status_code=400,
            )
        cache.clear()
        res = photo._generate_captions_im2txt()
        return Response({"status": res})


class SetPhotosShared(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        shared = data["shared"]  # bool
        target_user_id = data["target_user_id"]  # user pk, int
        image_hashes = data["image_hashes"]
        """
        From https://stackoverflow.com/questions/6996176/how-to-create-an-object-for-a-django-model-with-a-many-to-many-field/10116452#10116452
        # Access the through model directly
        ThroughModel = Sample.users.through

        users = Users.objects.filter(pk__in=[1,2])

        sample_object = Sample()
        sample_object.save()

        ThroughModel.objects.bulk_create([
            ThroughModel(users_id=users[0].pk, sample_id=sample_object.pk),
            ThroughModel(users_id=users[1].pk, sample_id=sample_object.pk)
        ])
        """

        ThroughModel = Photo.shared_to.through
        cache.clear()
        if shared:
            already_existing = ThroughModel.objects.filter(
                user_id=target_user_id, photo_id__in=image_hashes
            ).only("photo_id")
            already_existing_image_hashes = [e.photo_id for e in already_existing]
            # print(already_existing)
            res = ThroughModel.objects.bulk_create(
                [
                    ThroughModel(user_id=target_user_id, photo_id=image_hash)
                    for image_hash in image_hashes
                    if image_hash not in already_existing_image_hashes
                ]
            )
            logger.info(
                "Shared {}'s {} images to user {}".format(
                    request.user.id, len(res), target_user_id
                )
            )
            res_count = len(res)
        else:
            res = ThroughModel.objects.filter(
                user_id=target_user_id, photo_id__in=image_hashes
            ).delete()
            logger.info(
                "Unshared {}'s {} images to user {}".format(
                    request.user.id, len(res), target_user_id
                )
            )
            res_count = res[0]

        return Response({"status": True, "count": res_count})


class SetPhotosPublic(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        val_public = data["val_public"]
        image_hashes = data["image_hashes"]

        updated = []
        not_updated = []
        for image_hash in image_hashes:
            try:
                photo = Photo.objects.get(image_hash=image_hash)
            except Photo.DoesNotExist:
                logger.warning(
                    "Could not set photo {} to public. It does not exist.".format(
                        image_hash
                    )
                )
                continue
            if photo.owner == request.user and photo.public != val_public:
                photo.public = val_public
                photo.save()
                updated.append(PhotoSerializer(photo).data)
            else:
                not_updated.append(PhotoSerializer(photo).data)
        cache.clear()
        if val_public:
            logger.info(
                "{} photos were set public. {} photos were already public.".format(
                    len(updated), len(not_updated)
                )
            )
        else:
            logger.info(
                "{} photos were set private. {} photos were already public.".format(
                    len(updated), len(not_updated)
                )
            )

        return Response(
            {
                "status": True,
                "results": updated,
                "updated": updated,
                "not_updated": not_updated,
            }
        )


class DeletePhotos(APIView):
    def delete(self, request):
        data = dict(request.data)
        photos = Photo.objects.in_bulk(data["image_hashes"])

        deleted = []
        not_deleted = []
        for photo in photos.values():
            if photo.owner == request.user:
                deleted.append(photo.image_hash)
                photo.manual_delete()
            else:
                not_deleted.append(photo.image_hash)
        cache.clear()
        return Response(
            {
                "status": True,
                "results": deleted,
                "not_deleted": not_deleted,
                "deleted": deleted,
            }
        )


class SetPhotosFavorite(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        val_favorite = data["favorite"]
        image_hashes = data["image_hashes"]

        updated = []
        not_updated = []
        user = User.objects.get(username=request.user)
        for image_hash in image_hashes:
            try:
                photo = Photo.objects.get(image_hash=image_hash)
            except Photo.DoesNotExist:
                logger.warning(
                    "Could not set photo {} to favorite. It does not exist.".format(
                        image_hash
                    )
                )
                continue
            if photo.owner == request.user:
                if val_favorite and photo.rating < user.favorite_min_rating:
                    photo.rating = user.favorite_min_rating
                    photo.save()
                    updated.append(PhotoSerializer(photo).data)
                elif not val_favorite and photo.rating >= user.favorite_min_rating:
                    photo.rating = 0
                    photo.save()
                    updated.append(PhotoSerializer(photo).data)
                else:
                    not_updated.append(PhotoSerializer(photo).data)
            else:
                not_updated.append(PhotoSerializer(photo).data)
        cache.clear()
        if val_favorite:
            logger.info(
                "{} photos were added to favorites. {} photos were already in favorites.".format(
                    len(updated), len(not_updated)
                )
            )
        else:
            logger.info(
                "{} photos were removed from favorites. {} photos were already not in favorites.".format(
                    len(updated), len(not_updated)
                )
            )
        return Response(
            {
                "status": True,
                "results": updated,
                "updated": updated,
                "not_updated": not_updated,
            }
        )


class SetPhotosHidden(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        val_hidden = data["hidden"]
        image_hashes = data["image_hashes"]

        updated = []
        not_updated = []
        for image_hash in image_hashes:
            try:
                photo = Photo.objects.get(image_hash=image_hash)
            except Photo.DoesNotExist:
                logger.warning(
                    "Could not set photo {} to hidden. It does not exist.".format(
                        image_hash
                    )
                )
                continue
            if photo.owner == request.user and photo.hidden != val_hidden:
                photo.hidden = val_hidden
                photo.save()
                updated.append(PhotoSerializer(photo).data)
            else:
                not_updated.append(PhotoSerializer(photo).data)
        cache.clear()
        if val_hidden:
            logger.info(
                "{} photos were set hidden. {} photos were already hidden.".format(
                    len(updated), len(not_updated)
                )
            )
        else:
            logger.info(
                "{} photos were set unhidden. {} photos were already unhidden.".format(
                    len(updated), len(not_updated)
                )
            )
        return Response(
            {
                "status": True,
                "results": updated,
                "updated": updated,
                "not_updated": not_updated,
            }
        )


class SetFacePersonLabel(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        person = get_or_create_person(name=data["person_name"])
        faces = Face.objects.in_bulk(data["face_ids"])

        updated = []
        not_updated = []
        for face in faces.values():
            if face.photo.owner == request.user:
                face.person = person
                face.person_label_is_inferred = False
                face.person_label_probability = 1.0
                face.save()
                updated.append(FaceListSerializer(face).data)
            else:
                not_updated.append(FaceListSerializer(face).data)
        cache.clear()
        return Response(
            {
                "status": True,
                "results": updated,
                "updated": updated,
                "not_updated": not_updated,
            }
        )


class DeleteFaces(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        faces = Face.objects.in_bulk(data["face_ids"])

        deleted = []
        not_deleted = []
        for face in faces.values():
            if face.photo.owner == request.user:
                deleted.append(face.id)
                face.delete()
            else:
                not_deleted.append(face.id)
        cache.clear()
        return Response(
            {
                "status": True,
                "results": deleted,
                "not_deleted": not_deleted,
                "deleted": deleted,
            }
        )


# Utility views

class DefaultRulesView(APIView):
    def get(self, request, format=None):
        res = DEFAULT_RULES_JSON
        return Response(res)

class PredefinedRulesView(APIView):
    def get(self, request, format=None):
        res = PREDEFINED_RULES_JSON
        return Response(res)

class RootPathTreeView(APIView):
    permission_classes = (IsAdminUser,)

    def get(self, request, format=None):
        try:
            res = [path_to_dict(ownphotos.settings.DATA_ROOT)]
            return Response(res)
        except Exception as e:
            logger.exception(str(e))
            return Response({"message": str(e)})


class SearchTermExamples(APIView):
    def get(self, request, format=None):
        search_term_examples = get_search_term_examples(request.user)
        return Response({"results": search_term_examples})


class ClusterFaceView(APIView):
    # @cache_response(CACHE_TTL_VIZ)
    def get(self, request, format=None):
        res = cluster_faces(request.user)
        return Response(res)


class SocialGraphView(APIView):
    # @cache_response(CACHE_TTL_VIZ)
    def get(self, request, format=None):
        res = build_social_graph(request.user)
        return Response(res)


class StatsView(APIView):
    def get(self, request, format=None):
        res = get_count_stats(user=request.user)
        return Response(res)


class LocationClustersView(APIView):
    def get(self, request, format=None):
        res = get_location_clusters(request.user)
        return Response(res)


class LocationSunburst(APIView):
    # @cache_response(CACHE_TTL_VIZ)
    def get(self, request, format=None):
        res = get_location_sunburst(request.user)
        return Response(res)


class LocationTimeline(APIView):
    # @cache_response(CACHE_TTL_VIZ)
    def get(self, request, format=None):
        res = get_location_timeline(request.user)
        return Response(res)


class PhotoMonthCountsView(APIView):
    # @cache_response(CACHE_TTL_VIZ)
    def get(self, request, format=None):
        res = get_photo_month_counts(request.user)
        return Response(res)


class SearchTermWordCloudView(APIView):
    # @cache_response(CACHE_TTL_VIZ)
    def get(self, request, format=None):
        res = get_searchterms_wordcloud(request.user)
        return Response(res)


# long running jobs
class ScanPhotosView(APIView):
    def get(self, request, format=None):
        try:
            job_id = uuid.uuid4()
            scan_photos.delay(request.user, False, job_id)
            return Response({"status": True, "job_id": job_id})
        except BaseException:
            logger.exception("An Error occured")
            return Response({"status": False})


class FullScanPhotosView(APIView):
    def get(self, request, format=None):
        try:
            job_id = uuid.uuid4()
            scan_photos.delay(request.user, True, job_id)
            return Response({"status": True, "job_id": job_id})
        except BaseException:
            logger.exception("An Error occured")
            return Response({"status": False})


class ScanFacesView(APIView):
    def get(self, request, format=None):
        try:
            job_id = uuid.uuid4()
            scan_faces.delay(request.user, job_id)
            return Response({"status": True, "job_id": job_id})
        except BaseException:
            logger.exception("An Error occured")
            return Response({"status": False})


class DeleteMissingPhotosView(APIView):
    def get(self, request, format=None):
        try:
            job_id = uuid.uuid4()
            delete_missing_photos(request.user, job_id)
            return Response({"status": True, "job_id": job_id})
        except BaseException:
            logger.exception("An Error occured")
            return Response({"status": False})


class TrainFaceView(APIView):
    def get(self, request, format=None):
        try:
            job_id = uuid.uuid4()
            train_faces.delay(request.user, job_id)
            return Response({"status": True, "job_id": job_id})
        except BaseException:
            logger.exception()
            return Response({"status": False})


class QueueAvailabilityView(APIView):
    def get(self, request, format=None):
        job_detail = None

        running_job = (
            LongRunningJob.objects.filter(finished=False)
            .order_by("-started_at")
            .first()
        )
        if running_job:
            job_detail = LongRunningJobSerializer(running_job).data

        return Response(
            {
                "status": True,
                "queue_can_accept_job": job_detail is None,
                "job_detail": job_detail,
            }
        )


class ListAllRQJobsView(APIView):
    def get(self, request, format=None):
        try:
            all_jobs = django_rq.get_queue().all()
            logger.info(str(all_jobs))
        except BaseException as e:
            logger.error(str(e))
        return Response({})


class RQJobStatView(APIView):
    def get(self, request, format=None):
        job_id = request.query_params["job_id"]
        # job_id = '1667f947-bf8c-4ca8-a1cc-f16c7f3615de'
        is_job_finished = django_rq.get_queue().fetch_job(job_id).is_finished
        return Response({"status": True, "finished": is_job_finished})


class MediaAccessView(APIView):
    permission_classes = (AllowAny,)

    def _get_protected_media_url(self, path, fname):
        return "protected_media/{}/{}".format(path, fname)

    # @silk_profile(name='media')
    def get(self, request, path, fname, format=None):
        jwt = request.COOKIES.get("jwt")
        image_hash = fname.split(".")[0].split("_")[0]
        try:
            photo = Photo.objects.get(image_hash=image_hash)
        except Photo.DoesNotExist:
            return HttpResponse(status=404)

        # grant access if the requested photo is public
        if photo.public:
            response = HttpResponse()
            response["Content-Type"] = "image/jpeg"
            response["X-Accel-Redirect"] = self._get_protected_media_url(path, fname)
            return response

        # forbid access if trouble with jwt
        if jwt is not None:
            try:
                token = AccessToken(jwt)
            except TokenError:
                return HttpResponseForbidden()
        else:
            return HttpResponseForbidden()

        # grant access if the user is owner of the requested photo
        # or the photo is shared with the user
        image_hash = fname.split(".")[0].split("_")[0]  # janky alert
        user = User.objects.filter(id=token["user_id"]).only("id").first()
        if photo.owner == user or user in photo.shared_to.all():
            response = HttpResponse()
            response["Content-Type"] = "image/jpeg"
            response["X-Accel-Redirect"] = self._get_protected_media_url(path, fname)
            return response
        else:
            for album in photo.albumuser_set.only("shared_to"):
                if user in album.shared_to.all():
                    response = HttpResponse()
                    response["Content-Type"] = "image/jpeg"
                    response["X-Accel-Redirect"] = self._get_protected_media_url(
                        path, fname
                    )
                    return response
        return HttpResponse(status=404)


class MediaAccessFullsizeOriginalView(APIView):
    permission_classes = (AllowAny,)

    def _get_protected_media_url(self, path, fname):
        return "/protected_media{}/{}".format(path, fname)

    def _transcode_video(self, path):
        ffmpeg_command = [
            "ffmpeg",
            "-i",
            path,
            "-vcodec",
            "libx264",
            "-preset",
            "ultrafast",
            "-movflags",
            "frag_keyframe+empty_moov",
            "-filter:v",
            ("scale=-2:" + str(720)),
            "-f",
            "mp4",
            "-",
        ]
        response = subprocess.Popen(
            ffmpeg_command,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        response_iterator = iter(response.stdout.readline, b"")

        for resp in response_iterator:
            yield resp

    def _generate_response(self, photo, path, fname, transcode_videos):
        if "thumbnail" in path:
            response = HttpResponse()
            filename = os.path.splitext(photo.square_thumbnail.path)[1]
            if "jpg" in filename:
                # handle non migrated systems
                response["Content-Type"] = "image/jpg"
                response["X-Accel-Redirect"] = photo.thumbnail_big.path
            if "webp" in filename:
                response["Content-Type"] = "image/webp"
                response["X-Accel-Redirect"] = self._get_protected_media_url(
                    path, fname + ".webp"
                )
            if "mp4" in filename:
                response["Content-Type"] = "video/mp4"
                response["X-Accel-Redirect"] = self._get_protected_media_url(
                    path, fname + ".mp4"
                )
            return response
        if "faces" in path:
            response = HttpResponse()
            response["Content-Type"] = "image/jpg"
            response["X-Accel-Redirect"] = self._get_protected_media_url(path, fname)
            return response
        if photo.video:
            # This is probably very slow -> Save the mime type when scanning
            mime = magic.Magic(mime=True)
            filename = mime.from_file(photo.image_paths[0])
            if transcode_videos:
                response = StreamingHttpResponse(
                    self._transcode_video(photo.image_paths[0]),
                    content_type="video/mp4",
                )
                return response
            else:
                response = HttpResponse()
                response["Content-Type"] = filename
                response["X-Accel-Redirect"] = iri_to_uri(
                    photo.image_paths[0].replace(
                        ownphotos.settings.DATA_ROOT, "/original"
                    )
                )
                return response
        # faces and avatars
        response = HttpResponse()
        response["Content-Type"] = "image/jpg"
        response["X-Accel-Redirect"] = self._get_protected_media_url(path, fname)
        return response

    def get(self, request, path, fname, format=None):
        if path.lower() == "avatars":
            jwt = request.COOKIES.get("jwt")
            if jwt is not None:
                try:
                    token = AccessToken(jwt)
                except TokenError:
                    return HttpResponseForbidden()
            else:
                return HttpResponseForbidden()
            try:
                user = User.objects.filter(id=token["user_id"]).only("id").first()
                response = HttpResponse()
                response["Content-Type"] = "image/png"
                response["X-Accel-Redirect"] = "/protected_media/" + path + "/" + fname
                return response
            except Exception:
                return HttpResponse(status=404)
        if path.lower() != "photos":
            jwt = request.COOKIES.get("jwt")
            image_hash = fname.split(".")[0].split("_")[0]
            try:
                photo = Photo.objects.get(image_hash=image_hash)
            except Photo.DoesNotExist:
                return HttpResponse(status=404)

            # grant access if the requested photo is public
            if photo.public:
                return self._generate_response(photo, path, fname, False)

            # forbid access if trouble with jwt
            if jwt is not None:
                try:
                    token = AccessToken(jwt)
                except TokenError:
                    return HttpResponseForbidden()
            else:
                return HttpResponseForbidden()

            # grant access if the user is owner of the requested photo
            # or the photo is shared with the user
            image_hash = fname.split(".")[0].split("_")[0]  # janky alert
            user = (
                User.objects.filter(id=token["user_id"])
                .only("id", "transcode_videos")
                .first()
            )
            if photo.owner == user or user in photo.shared_to.all():
                return self._generate_response(
                    photo, path, fname, user.transcode_videos
                )
            else:
                for album in photo.albumuser_set.only("shared_to"):
                    if user in album.shared_to.all():
                        return self._generate_response(
                            photo, path, fname, user.transcode_videos
                        )
            return HttpResponse(status=404)
        else:
            jwt = request.COOKIES.get("jwt")
            image_hash = fname.split(".")[0].split("_")[0]
            try:
                photo = Photo.objects.get(image_hash=image_hash)
            except Photo.DoesNotExist:
                return HttpResponse(status=404)

            if photo.image_paths[0].startswith("/nextcloud_media/"):
                internal_path = photo.image_paths[0].replace(
                    "/nextcloud_media/", "/nextcloud_original/"
                )
                internal_path = "/nextcloud_original" + photo.image_paths[0][21:]
            if photo.image_paths[0].startswith("/data/"):
                internal_path = "/original" + photo.image_paths[0][5:]

            # grant access if the requested photo is public
            if photo.public:
                response = HttpResponse()
                response["Content-Type"] = "image/jpeg"
                response["X-Accel-Redirect"] = internal_path
                return response

            # forbid access if trouble with jwt
            if jwt is not None:
                try:
                    token = AccessToken(jwt)
                except TokenError:
                    return HttpResponseForbidden()
            else:
                return HttpResponseForbidden()

            # grant access if the user is owner of the requested photo
            # or the photo is shared with the user
            image_hash = fname.split(".")[0].split("_")[0]  # janky alert
            user = User.objects.filter(id=token["user_id"]).only("id").first()
            if photo.owner == user or user in photo.shared_to.all():
                response = HttpResponse()
                response["Content-Type"] = "image/jpeg"
                response["X-Accel-Redirect"] = internal_path
                return response
            else:
                for album in photo.albumuser_set.only("shared_to"):
                    if user in album.shared_to.all():
                        response = HttpResponse()
                        response["Content-Type"] = "image/jpeg"
                        response["X-Accel-Redirect"] = internal_path
                        return response
            return HttpResponse(status=404)


class ZipListPhotosView(APIView):
    def post(self, request, format=None):
        try:
            data = dict(request.data)
            if "image_hashes" not in data:
                return
            photos = Photo.objects.filter(owner=self.request.user).in_bulk(
                data["image_hashes"]
            )
            if len(photos) == 0:
                return
            mf = io.BytesIO()
            photos_name = {}
            for photo in photos.values():
                photo_name = os.path.basename(photo.image_paths[0])
                if photo_name in photos_name:
                    photos_name[photo_name] = photos_name[photo_name] + 1
                    photo_name = str(photos_name[photo_name]) + "-" + photo_name
                else:
                    photos_name[photo_name] = 1
                with zipfile.ZipFile(
                    mf, mode="a", compression=zipfile.ZIP_DEFLATED
                ) as zf:
                    zf.write(photo.image_paths[0], arcname=photo_name)
            return HttpResponse(
                mf.getvalue(), content_type="application/x-zip-compressed"
            )
        except BaseException as e:
            logger.error(str(e))
            return HttpResponse(status=404)
