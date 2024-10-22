import uuid

from django.db.models import Case, CharField, Count, IntegerField, Q, Value, When
from django_q.tasks import Chain
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from api.directory_watcher import generate_face_embeddings, scan_faces
from api.face_classify import cluster_all_faces
from api.ml_models import do_all_models_exist, download_models
from api.models import Face
from api.models.person import Person, get_or_create_person
from api.serializers.face import (
    FaceListSerializer,
    IncompletePersonFaceListSerializer,
    PersonFaceListSerializer,
)
from api.util import logger
from api.views.custom_api_view import ListViewSet
from api.views.pagination import RegularResultsSetPagination


class ScanFacesView(APIView):
    @extend_schema(
        deprecated=True,
        description="Use POST method",
    )
    def get(self, request, format=None):
        return self._scan_faces(request)

    def post(self, request, format=None):
        return self._scan_faces(request)

    def _scan_faces(self, request, format=None):
        chain = Chain()
        if not do_all_models_exist():
            chain.append(download_models, request.user)
        try:
            job_id = uuid.uuid4()
            chain.append(scan_faces, request.user, job_id, True)
            chain.run()
            return Response({"status": True, "job_id": job_id})
        except BaseException:
            logger.exception("An Error occurred")
            return Response({"status": False})


class TrainFaceView(APIView):
    @staticmethod
    def _train_faces(request):
        chain = Chain()
        if not do_all_models_exist():
            chain.append(download_models, request.user)
        try:
            job_id = uuid.uuid4()
            chain.append(generate_face_embeddings, request.user, uuid.uuid4())
            chain.append(cluster_all_faces, request.user, job_id)
            chain.run()
            return Response({"status": True, "job_id": job_id})
        except BaseException:
            logger.exception()
            return Response({"status": False})

    def post(self, request, format=None):
        return self._train_faces(request)


class FaceListView(ListViewSet):
    serializer_class = PersonFaceListSerializer
    pagination_class = RegularResultsSetPagination

    def get_queryset(self):
        personid = self.request.query_params.get("person", "0")

        if personid == "0":
            personid = None

        analysis_method = self.request.query_params.get("analysis_method", "clustering")
        min_confidence = float(self.request.query_params.get("min_confidence", 0))

        if (
            self.request.query_params.get("inferred", "").lower() == "false"
            and personid
        ):
            analysis_method = None
        if analysis_method == "classification":
            conditional_filter = Q(person=None)
            if not personid:
                conditional_filter = conditional_filter & Q(
                    classification_probability__lte=min_confidence
                )
            else:
                conditional_filter = (
                    conditional_filter
                    & Q(classification_person=personid)
                    & Q(classification_probability__gte=min_confidence)
                )
            order_by = ["-classification_probability", "id"]
        if analysis_method == "clustering":
            if not personid:
                conditional_filter = Q(person=None) & (
                    Q(cluster_person=None) | Q(cluster_probability__lte=min_confidence)
                )
            else:
                conditional_filter = (
                    Q(cluster_person=personid)
                    & Q(person=None)
                    & Q(cluster_probability__gte=min_confidence)
                )
            order_by = ["-cluster_probability", "id"]
        if not analysis_method:
            conditional_filter = Q(person=personid)
            order_by = ["-id"]
        if self.request.query_params.get("order_by", "").lower() == "date":
            order_by = ["photo__exif_timestamp", *order_by]
        return (
            Face.objects.filter(
                Q(photo__owner=self.request.user),
                Q(deleted=False),
                conditional_filter,
            )
            .annotate(analysis_method=Value(analysis_method, output_field=CharField()))
            .prefetch_related("photo")
            .order_by(*order_by)
        )

    @extend_schema(
        parameters=[
            OpenApiParameter("person", OpenApiTypes.STR),
            OpenApiParameter("inferred", OpenApiTypes.BOOL),
            OpenApiParameter("order_by", OpenApiTypes.STR),
        ],
    )
    def list(self, *args, **kwargs):
        return super(FaceListView, self).list(*args, **kwargs)


class FaceIncompleteListViewSet(ListViewSet):
    serializer_class = IncompletePersonFaceListSerializer
    pagination_class = None

    def get_queryset(self):
        inferred = self.request.query_params.get("inferred", "").lower() == "true"
        analysis_method = self.request.query_params.get("analysis_method", "clustering")
        min_confidence = float(self.request.query_params.get("min_confidence", 0))

        queryset = Person.objects.filter(cluster_owner=self.request.user)
        if inferred:
            if analysis_method == "classification":
                conditional_count = Count(
                    Case(
                        When(
                            Q(classification_faces__deleted=False)
                            & Q(classification_faces__person=None)
                            & Q(
                                classification_faces__classification_probability__gte=min_confidence
                            ),
                            then=1,
                        ),
                        output_field=IntegerField(),
                    )
                )
            if analysis_method == "clustering":
                conditional_count = Count(
                    Case(
                        When(
                            Q(cluster_faces__deleted=False)
                            & Q(cluster_faces__person=None)
                            & Q(cluster_faces__cluster_probability__gte=min_confidence),
                            then=1,
                        ),
                        output_field=IntegerField(),
                    )
                )
        else:
            queryset = queryset.filter(kind=Person.KIND_USER)
            conditional_count = Count(
                Case(
                    When(
                        Q(faces__deleted=False),
                        then=1,
                    ),
                    output_field=IntegerField(),
                )
            )

        queryset = (
            queryset.annotate(viewable_face_count=conditional_count)
            .filter(viewable_face_count__gt=0)
            .order_by("name")
        )

        return queryset

    @extend_schema(
        parameters=[
            OpenApiParameter("inferred", OpenApiTypes.BOOL),
        ],
    )
    def list(self, *args, **kwargs):
        queryset = self.get_queryset()

        serializer = self.get_serializer(queryset, many=True)
        real_persons = serializer.data

        min_confidence = float(self.request.query_params.get("min_confidence", 0))

        if self.request.query_params.get("inferred", "").lower() == "true":
            if (
                self.request.query_params.get("analysis_method", "clustering")
                == "classification"
            ):
                unknown_faces_count = Face.objects.filter(
                    Q(deleted=False)
                    & Q(person=None)
                    & Q(photo__owner=self.request.user)
                    & Q(classification_probability__lte=min_confidence),
                ).count()
            else:
                unknown_faces_count = Face.objects.filter(
                    (
                        Q(cluster_person=None)
                        | Q(cluster_probability__lte=min_confidence)
                    )
                    & Q(deleted=False)
                    & Q(person=None)
                    & Q(photo__owner=self.request.user),
                ).count()
        else:
            unknown_faces_count = Face.objects.filter(
                person=None, deleted=False, photo__owner=self.request.user
            ).count()

        if unknown_faces_count > 0:
            unknown_person = {
                "id": 0,
                "name": "Unknown - Other",
                "face_count": unknown_faces_count,
                "kind": Person.UNKNOWN_PERSON_NAME,
            }
            real_persons.append(unknown_person)

        return Response(real_persons, status=status.HTTP_200_OK)


class SetFacePersonLabel(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        person = None
        cluster_person = None
        classification_person = None
        if data["person_name"] != Person.UNKNOWN_PERSON_NAME:
            person = get_or_create_person(
                name=data["person_name"], owner=self.request.user, kind=Person.KIND_USER
            )

        faces = Face.objects.in_bulk(data["face_ids"])

        updated = []
        not_updated = []
        for face in faces.values():
            if face.photo.owner == request.user:
                face.person = person
                if not person:
                    face.cluster_person = cluster_person
                    face.classification_person = classification_person
                face.save()
                updated.append(FaceListSerializer(face).data)
            else:
                not_updated.append(FaceListSerializer(face).data)
        if person:
            person._calculate_face_count()
            person._set_default_cover_photo()
        face.photo._recreate_search_captions()
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
                deleted.append(face.image.url)
                face.deleted = True
                face.save()
            else:
                not_deleted.append(face.image.url)

        return Response(
            {
                "status": True,
                "results": deleted,
                "not_deleted": not_deleted,
                "deleted": deleted,
            }
        )
