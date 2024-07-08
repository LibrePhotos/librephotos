import uuid

from django.db.models import Case, Count, IntegerField, Q, When
from django_q.tasks import Chain
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
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
        personid = self.request.query_params.get("person")
        inferred = False
        order_by = ["-person_label_probability", "id"]
        conditional_filter = Q(person_label_is_inferred=inferred) | Q(
            person__name=Person.UNKNOWN_PERSON_NAME
        )
        if (
            self.request.query_params.get("inferred")
            and self.request.query_params.get("inferred").lower() == "true"
        ):
            inferred = True
            conditional_filter = Q(person_label_is_inferred=inferred)
        if self.request.query_params.get("order_by"):
            if self.request.query_params.get("order_by").lower() == "date":
                order_by = ["photo__exif_timestamp", "-person_label_probability", "id"]
        return (
            Face.objects.filter(
                Q(photo__owner=self.request.user),
                Q(person=personid),
                conditional_filter,
            )
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

        queryset = Person.objects.filter(cluster_owner=self.request.user)

        queryset = (
            queryset.annotate(
                viewable_face_count=Count(
                    Case(
                        When(
                            Q(faces__person_label_is_inferred=inferred)
                            | Q(faces__person__name=Person.UNKNOWN_PERSON_NAME),
                            then=1,
                        ),
                        output_field=IntegerField(),
                    )
                )
            )
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
        return super(FaceIncompleteListViewSet, self).list(*args, **kwargs)


class SetFacePersonLabel(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        if data["person_name"] == Person.UNKNOWN_PERSON_NAME:
            # We do this to unlabel a face
            # TODO: this is a hack, we should have a better way to handle this
            #       maybe a separate endpoint for setting unknown person labels?
            person = get_or_create_person(
                name=data["person_name"],
                owner=self.request.user,
                kind=Person.KIND_UNKNOWN,
            )
        else:
            person = get_or_create_person(
                name=data["person_name"], owner=self.request.user, kind=Person.KIND_USER
            )
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
                face.delete()
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
