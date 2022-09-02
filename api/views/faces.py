import uuid

from django.db.models import Count, Q
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from api.directory_watcher import scan_faces
from api.face_classify import cluster_all_faces
from api.models import Face
from api.models.person import Person, get_or_create_person
from api.serializers.face import (
    FaceListSerializer,
    IncompletePersonFaceListSerializer,
    PersonFaceListSerializer,
)
from api.util import logger
from api.views.custom_api_view import ListViewSet
from api.views.pagination import HugeResultsSetPagination, RegularResultsSetPagination


class ScanFacesView(APIView):
    def get(self, request, format=None):
        try:
            job_id = uuid.uuid4()
            scan_faces.delay(request.user, job_id)
            return Response({"status": True, "job_id": job_id})
        except BaseException:
            logger.exception("An Error occured")
            return Response({"status": False})


class TrainFaceView(APIView):
    def get(self, request, format=None):
        try:
            job_id = uuid.uuid4()
            cluster_all_faces.delay(request.user, job_id)
            return Response({"status": True, "job_id": job_id})
        except BaseException:
            logger.exception()
            return Response({"status": False})


class FaceListView(ListViewSet):
    serializer_class = PersonFaceListSerializer
    pagination_class = RegularResultsSetPagination

    def get_queryset(self):
        personid = self.request.query_params.get("person")
        inferred = False
        conditional_filter = Q(person_label_is_inferred=inferred) | Q(
            person__name=Person.UNKNOWN_PERSON_NAME
        )
        if (
            self.request.query_params.get("inferred")
            and self.request.query_params.get("inferred").lower() == "true"
        ):
            inferred = True
            conditional_filter = Q(person_label_is_inferred=inferred)
        return (
            Face.objects.filter(
                Q(photo__owner=self.request.user),
                Q(person=personid),
                conditional_filter,
            )
            .prefetch_related("photo")
            .order_by("id")
        )

    @extend_schema(
        parameters=[
            OpenApiParameter("person", OpenApiTypes.STR),
            OpenApiParameter("inferred", OpenApiTypes.BOOL),
        ],
    )
    def list(self, *args, **kwargs):
        return super(FaceListView, self).list(*args, **kwargs)


class FaceIncompleteListViewSet(ListViewSet):
    serializer_class = IncompletePersonFaceListSerializer
    pagination_class = None

    def get_queryset(self):
        inferred = False
        conditional_filter = Q(faces__person_label_is_inferred=inferred) | Q(
            faces__person__name=Person.UNKNOWN_PERSON_NAME
        )
        if (
            self.request.query_params.get("inferred")
            and self.request.query_params.get("inferred").lower() == "true"
        ):
            inferred = True
            conditional_filter = Q(faces__person_label_is_inferred=inferred)

        queryset = (
            Person.objects.filter(cluster_owner=self.request.user)
            .annotate(face_count=Count("faces", filter=conditional_filter))
            .filter(face_count__gt=0)
            .order_by("name")
        )
        return queryset

    @extend_schema(
        parameters=[
            OpenApiParameter("inferred", OpenApiTypes.BOOL),
        ],
    )
    def list(self, *args, **kwargs):
        return super(FaceIncompleteListViewSet, self).list(*args, **kwargs)


class FaceInferredListViewSet(ListViewSet):
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

    @extend_schema(deprecated=True)
    def list(self, *args, **kwargs):
        return super(FaceInferredListViewSet, self).list(*args, **kwargs)


class FaceLabeledListViewSet(ListViewSet):
    serializer_class = FaceListSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        # Todo: optimze query by only prefetching relevant models & fields
        queryset = (
            Face.objects.filter(
                Q(photo__hidden=False) & Q(photo__owner=self.request.user),
                Q(person_label_is_inferred=False)
                | Q(person__name=Person.UNKNOWN_PERSON_NAME),
            )
            .select_related("person")
            .order_by("id")
        )
        return queryset

    @extend_schema(deprecated=True)
    def list(self, *args, **kwargs):
        return super(FaceLabeledListViewSet, self).list(*args, **kwargs)


class SetFacePersonLabel(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        person = get_or_create_person(name=data["person_name"], owner=self.request.user)
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

        return Response(
            {
                "status": True,
                "results": deleted,
                "not_deleted": not_deleted,
                "deleted": deleted,
            }
        )
