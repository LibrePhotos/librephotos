import uuid

from django.core.cache import cache
from django.db.models import Q
from rest_framework import viewsets
from rest_framework.response import Response
from rest_framework.views import APIView

from api.directory_watcher import scan_faces
from api.face_classify import train_faces
from api.models import Face
from api.models.person import get_or_create_person
from api.serializers.serializers import FaceListSerializer, FaceSerializer
from api.util import logger
from api.views.pagination import HugeResultsSetPagination, StandardResultsSetPagination


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
            train_faces.delay(request.user, job_id)
            return Response({"status": True, "job_id": job_id})
        except BaseException:
            logger.exception()
            return Response({"status": False})


class FaceListViewSet(viewsets.ModelViewSet):
    serializer_class = FaceListSerializer
    pagination_class = StandardResultsSetPagination

    def retrieve(self, *args, **kwargs):
        return super(FaceListViewSet, self).retrieve(*args, **kwargs)

    def list(self, *args, **kwargs):
        return super(FaceListViewSet, self).list(*args, **kwargs)


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

    def retrieve(self, *args, **kwargs):
        return super(FaceInferredListViewSet, self).retrieve(*args, **kwargs)

    def list(self, *args, **kwargs):
        return super(FaceInferredListViewSet, self).list(*args, **kwargs)


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

    def retrieve(self, *args, **kwargs):
        return super(FaceLabeledListViewSet, self).retrieve(*args, **kwargs)

    def list(self, *args, **kwargs):
        return super(FaceLabeledListViewSet, self).list(*args, **kwargs)


class FaceViewSet(viewsets.ModelViewSet):
    queryset = (
        Face.objects.filter(Q(photo__hidden=False))
        .prefetch_related("person")
        .order_by("id")
    )
    serializer_class = FaceSerializer
    pagination_class = StandardResultsSetPagination

    def retrieve(self, *args, **kwargs):
        return super(FaceViewSet, self).retrieve(*args, **kwargs)

    def list(self, *args, **kwargs):
        return super(FaceViewSet, self).list(*args, **kwargs)


class FaceInferredViewSet(viewsets.ModelViewSet):
    serializer_class = FaceSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return Face.objects.filter(
            Q(photo__hidden=False)
            & Q(photo__owner=self.request.user)
            & Q(person_label_is_inferred=True)
        ).order_by("id")

    def retrieve(self, *args, **kwargs):
        return super(FaceInferredViewSet, self).retrieve(*args, **kwargs)

    def list(self, *args, **kwargs):
        return super(FaceInferredViewSet, self).list(*args, **kwargs)


class FaceLabeledViewSet(viewsets.ModelViewSet):
    serializer_class = FaceSerializer
    pagination_class = HugeResultsSetPagination

    def get_queryset(self):
        return Face.objects.filter(
            Q(photo__hidden=False)
            & Q(photo__owner=self.request.user)
            & Q(person_label_is_inferred=False)
        ).order_by("id")

    def retrieve(self, *args, **kwargs):
        return super(FaceLabeledViewSet, self).retrieve(*args, **kwargs)

    def list(self, *args, **kwargs):
        return super(FaceLabeledViewSet, self).list(*args, **kwargs)


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
