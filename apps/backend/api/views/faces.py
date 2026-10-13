import logging
import uuid
from typing import Any

import PIL.Image
from django.db.models import (
    Case,
    CharField,
    Count,
    IntegerField,
    Prefetch,
    Q,
    QuerySet,
    Value,
    When,
)
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.directory_watcher import generate_face_embeddings, scan_faces
from api.drf.exceptions import Conflict
from api.drf.pagination import DefaultPagination
from api.drf.params import parse_body, parse_query
from api.drf.request_user import request_user
from api.faces import photo_faces
from api.faces.classify import cluster_all_faces
from api.faces.labels import (
    recreate_search_captions,
    relabel_faces,
    write_face_tags_of,
)
from api.faces.photo_faces import (
    DetectedFace,
    overlaps_existing_face,
    save_detected_face,
)
from api.jobs.queue import JobStep
from api.jobs.start import start_job, start_jobs
from api.models import Face, LongRunningJob, Photo
from api.models.person import Person, get_or_create_person
from api.models.thumbnail import Thumbnail
from api.runtime.features import feature_enabled
from api.runtime.ml_models import missing_models_prerequisites
from api.serializers.face import (
    AddFaceRequest,
    AddFaceResponse,
    FaceIdsRequest,
    FaceIncompleteListQuery,
    FaceListQuery,
    FaceListSerializer,
    IncompletePersonFaceListSerializer,
    PersonFaceListSerializer,
    SetFacePersonLabelRequest,
    SetFacePersonLabelResponse,
)
from api.views.custom_api_view import ListViewSet
from api.views.photos import _get_photo_filter_kwargs

logger = logging.getLogger(__name__)


class ScanFacesView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        deprecated=True,
        description="Use POST method",
    )
    def get(self, request: Request, format: str | None = None) -> Response:
        return self._scan_faces(request)

    def post(self, request: Request, format: str | None = None) -> Response:
        return self._scan_faces(request)

    def _scan_faces(self, request: Request, format: str | None = None) -> Response:
        if not feature_enabled("FACE_DETECTION"):
            raise PermissionDenied("Face detection is disabled")

        user = request_user(request)
        return start_job(
            user,
            LongRunningJob.JOB_SCAN_FACES,
            scan_faces,
            user,
            full_scan=True,
            description="the face scan",
            prerequisites=missing_models_prerequisites(user),
        )


class TrainFaceView(APIView):
    permission_classes = (IsAuthenticated,)

    @staticmethod
    def _train_faces(request: Request) -> Response:
        if not feature_enabled("FACE_CLUSTER"):
            raise PermissionDenied("Face clustering is disabled")
        user = request_user(request)
        # Embeddings first, then clustering, which queues the training. The
        # answer's job_id is the clustering job's; job_ids has both. A failure
        # to queue answers 500 (start_jobs); it used to be a 200 with
        # "status": false, which clients showed as "training started".
        return start_jobs(
            user,
            [
                JobStep(
                    LongRunningJob.JOB_GENERATE_FACE_EMBEDDINGS,
                    generate_face_embeddings,
                    (user,),
                ),
                JobStep(
                    LongRunningJob.JOB_CLUSTER_ALL_FACES, cluster_all_faces, (user,)
                ),
            ],
            "the face training",
            prerequisites=missing_models_prerequisites(user),
        )

    def post(self, request: Request, format: str | None = None) -> Response:
        return self._train_faces(request)


class FaceListView(ListViewSet):
    permission_classes = (IsAuthenticated,)
    serializer_class = PersonFaceListSerializer
    pagination_class = DefaultPagination

    def get_queryset(self) -> QuerySet[Face]:
        # drf-spectacular asks with an anonymous request; photo__owner rejects it.
        if getattr(self, "swagger_fake_view", False):
            return Face.objects.none()
        params = parse_query(self.request, FaceListQuery)
        personid: int | None = params["person"] or None
        analysis_method: str | None = params["analysis_method"]
        min_confidence = params["min_confidence"]

        if not params["inferred"] and personid:
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
        if params["order_by"].lower() == "date":
            order_by = ["photo__exif_timestamp", *order_by]
        return (
            Face.objects.owned_by(self.request.user)
            .filter(Q(deleted=False), conditional_filter)
            .annotate(analysis_method=Value(analysis_method, output_field=CharField()))
            .prefetch_related("photo")
            .order_by(*order_by)
        )

    @extend_schema(parameters=[FaceListQuery])
    def list(self, *args: Any, **kwargs: Any) -> Response:
        return super().list(*args, **kwargs)


class FaceIncompleteListViewSet(ListViewSet):
    permission_classes = (IsAuthenticated,)
    serializer_class = IncompletePersonFaceListSerializer
    pagination_class = None

    def get_queryset(self) -> QuerySet[Person]:
        # drf-spectacular asks with an anonymous request; request_user rejects it.
        if getattr(self, "swagger_fake_view", False):
            return Person.objects.none()
        user = request_user(self.request)
        params = parse_query(self.request, FaceIncompleteListQuery)
        inferred = params["inferred"]
        analysis_method = params["analysis_method"]
        min_confidence = params["min_confidence"]

        queryset = Person.objects.owned_by(user)
        # Every count below is scoped to the requester's own photos, because
        # FaceListView scopes its rows the same way (`photo__owner`). Without
        # it, a person shared with another user is counted across both
        # libraries while the list returns only this user's faces, so the
        # dashboard grid draws slots that can never be filled and the last page
        # 404s with "Invalid page" (#2031). `cluster_owner` scopes the person,
        # not its faces, so it does not cover this.
        if inferred:
            if analysis_method == "classification":
                conditional_count = Count(
                    Case(
                        When(
                            Q(classification_faces__deleted=False)
                            & Q(classification_faces__person=None)
                            & Q(
                                classification_faces__classification_probability__gte=min_confidence
                            )
                            & Face.objects.owner_q(
                                user, through="classification_faces__"
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
                            & Q(cluster_faces__cluster_probability__gte=min_confidence)
                            & Face.objects.owner_q(user, through="cluster_faces__"),
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
                        Q(faces__deleted=False)
                        & Face.objects.owner_q(user, through="faces__"),
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

    @extend_schema(parameters=[FaceIncompleteListQuery])
    def list(self, *args: Any, **kwargs: Any) -> Response:
        user = request_user(self.request)
        params = parse_query(self.request, FaceIncompleteListQuery)
        queryset = self.get_queryset()

        serializer = self.get_serializer(queryset, many=True)
        real_persons = serializer.data

        min_confidence = params["min_confidence"]

        if params["inferred"]:
            if params["analysis_method"] == "classification":
                unknown_faces_count = (
                    Face.objects.owned_by(user)
                    .filter(
                        Q(deleted=False)
                        & Q(person=None)
                        & Q(classification_probability__lte=min_confidence),
                    )
                    .count()
                )
            else:
                unknown_faces_count = (
                    Face.objects.owned_by(user)
                    .filter(
                        (
                            Q(cluster_person=None)
                            | Q(cluster_probability__lte=min_confidence)
                        )
                        & Q(deleted=False)
                        & Q(person=None),
                    )
                    .count()
                )
        else:
            unknown_faces_count = (
                Face.objects.owned_by(user).filter(person=None, deleted=False).count()
            )

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
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=SetFacePersonLabelRequest, responses=SetFacePersonLabelResponse
    )
    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        data = parse_body(request, SetFacePersonLabelRequest)
        person: Person | None = None
        # Person.name carries a MinLengthValidator, but get_or_create() does not run
        # field validators, so a blank name would quietly create a nameless person
        # and an album to go with it. Surrounding whitespace is trimmed for the same
        # reason: " Bob " would otherwise become a second person next to "Bob".
        # The serializer refuses a blank name and trims the rest.
        person_name = data["person_name"]
        if person_name != Person.UNKNOWN_PERSON_NAME:
            # A cluster's label is not a person's name. Clustering backs every
            # unnamed cluster with a Person of kind CLUSTER called "Unknown NNN",
            # and that label reaches the client in the same field a real name
            # arrives in. get_or_create_person() looks a row up by
            # (name, cluster_owner, kind), so asking for KIND_USER would not find
            # the cluster: it would mint a *second* person with that name, of the
            # kind that gets a person album and trains the classifier, and move
            # the face onto it. The face dashboard has always hidden confirm for
            # these kinds; the photo's own face list had not.
            if (
                Person.objects.owned_by(user)
                .filter(
                    name=person_name,
                    kind__in=(Person.KIND_CLUSTER, Person.KIND_UNKNOWN),
                )
                .exists()
            ):
                raise ValidationError(
                    {
                        "person_name": (
                            f'"{person_name}" is the label of a face cluster, not a '
                            "person. Name the face instead of confirming the cluster."
                        )
                    }
                )
            person = get_or_create_person(
                name=person_name, owner=user, kind=Person.KIND_USER
            )

        # Only the requester's own faces are relabelled (relabel_faces scopes
        # them again): a foreign face id must not come back serialized in
        # ``not_updated`` (it carried the photo id and the face crop path of
        # someone else's photo).
        result = relabel_faces(
            user, Face.objects.owned_by(user).filter(pk__in=data["face_ids"]), person
        )
        updated = [FaceListSerializer(face).data for face in result.faces]
        not_updated: list[dict[str, object]] = []
        return Response(
            {
                "status": True,
                "results": updated,
                "updated": updated,
                "not_updated": not_updated,
                # The labels are saved; their face tags did not reach these
                # files (#2294).
                "write_error": result.write_error,
            }
        )


class AddFaceView(APIView):
    """Create a face from a box the user drew on a photo.

    Until now every Face row came from the detector or from an XMP region already
    written into the file, so a face the detector missed could not be recorded at
    all -- someone turned away from the camera, a child, a face behind a hat. This
    is the manual way in.

    The box arrives normalized to the displayed image (each side a fraction of the
    width or height) because fractions are what the browser can measure. Face rows
    store pixels in big-thumbnail space, and the big thumbnail is the image the
    lightbox displays, so converting is a multiplication by the thumbnail's own
    size -- no separate coordinate mapping is involved.

    A manually added face is a user label: it gets ``person`` set with
    ``KIND_USER`` and no cluster, so classification trains on it like any other
    face the user named, but it never seeds a cluster of its own.
    """

    permission_classes = (IsAuthenticated,)

    # A box smaller than this in big-thumbnail pixels is a stray drag, not a face.
    MIN_SIDE_PIXELS = 12

    @extend_schema(request=AddFaceRequest, responses={201: AddFaceResponse})
    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        data = parse_body(request, AddFaceRequest)
        person_name = data["person_name"]
        if person_name == Person.UNKNOWN_PERSON_NAME:
            raise self._error(
                "a face drawn by hand has to name someone; "
                f"'{Person.UNKNOWN_PERSON_NAME}' is what the algorithms use"
            )

        photo = (
            Photo.objects.owned_by(user)
            .filter(**_get_photo_filter_kwargs(data["photo"]))
            .select_related(
                "owner", "thumbnail", "main_file", "metadata", "caption_instance"
            )
            .prefetch_related("files", "faces__person")
            .first()
        )
        if photo is None:
            raise NotFound("photo not found")

        thumbnail_path = self._thumbnail_path(photo)
        if thumbnail_path is None:
            raise self._error(
                "this photo has no big thumbnail yet, so there is nothing to "
                "measure the box against"
            )

        try:
            big_thumbnail = PIL.Image.open(thumbnail_path)
        except OSError:
            logger.exception("Cannot open thumbnail for photo %s", photo.image_hash)
            raise self._error("this photo's thumbnail cannot be read")

        with big_thumbnail:
            box, error = self._box_in_pixels(
                data.get("box"),
                big_thumbnail.width,
                big_thumbnail.height,
            )
            if error:
                raise self._error(error)
            # _box_in_pixels returns a box whenever it reports no error.
            assert box is not None
            top, right, bottom, left = box

            existing = photo.faces.filter(deleted=False).values_list(
                "location_top", "location_right", "location_bottom", "location_left"
            )
            if overlaps_existing_face(existing, top, right, bottom, left):
                raise Conflict(
                    "there is already a face here; label that one "
                    "instead of adding a second face over it"
                )

            face_image = big_thumbnail.crop((left, top, right, bottom))
            person = get_or_create_person(
                name=person_name, owner=user, kind=Person.KIND_USER
            )
            face = save_detected_face(
                photo,
                DetectedFace(face_image, (top, right, bottom, left)),
                f"{photo.image_hash}_manual_{uuid.uuid4().hex[:8]}.jpg",
                person,
                None,
            )

        # Without an encoding the face is still a valid label -- it just cannot be
        # compared to anything yet. "Train faces" encodes faces that have none, so
        # a face service that is down or disabled delays recognition rather than
        # losing the user's work.
        try:
            photo_faces.generate_face_encoding(face)
        except Exception:
            logger.exception(
                "Could not encode manually added face %s; "
                "it will be encoded by the next face training run",
                face.id,
            )

        person._calculate_face_count()
        person._set_default_cover_photo()

        # The person's name is part of what the photo can be found by.
        photo.refresh_from_db()
        recreate_search_captions([photo])

        write_error = write_face_tags_of(user, [photo])

        return Response(
            {
                "status": True,
                "write_error": write_error,
                "face": {
                    "face_id": face.id,
                    "face_url": face.image.url,
                    "person": person.id,
                    "person_name": person.name,
                    "location": {
                        "top": top,
                        "right": right,
                        "bottom": bottom,
                        "left": left,
                    },
                },
            },
            status=status.HTTP_201_CREATED,
        )

    @staticmethod
    def _error(message: str) -> ValidationError:
        return ValidationError(message)

    @staticmethod
    def _thumbnail_path(photo: Photo) -> str | None:
        thumbnail: Thumbnail | None = getattr(photo, "thumbnail", None)
        if thumbnail is None or not thumbnail.thumbnail_big:
            return None
        try:
            path: str = thumbnail.thumbnail_big.path
        except (ValueError, NotImplementedError):
            return None
        return path

    @classmethod
    def _box_in_pixels(
        cls, box: object, width: int, height: int
    ) -> tuple[tuple[int, int, int, int] | None, str | None]:
        """Turn a normalized box into big-thumbnail pixels.

        Returns ``((top, right, bottom, left), None)`` or ``(None, message)``.
        """
        if not isinstance(box, dict):
            return None, "box is required, with top, right, bottom and left"

        sides: dict[str, float] = {}
        for side in ("top", "right", "bottom", "left"):
            try:
                sides[side] = float(box[side])
            except (KeyError, TypeError, ValueError):
                return None, f"box.{side} must be a number between 0 and 1"
            if not 0 <= sides[side] <= 1:
                return None, f"box.{side} must be between 0 and 1"

        if sides["right"] <= sides["left"] or sides["bottom"] <= sides["top"]:
            return None, "box must have a positive width and height"

        top = int(round(sides["top"] * height))
        bottom = int(round(sides["bottom"] * height))
        left = int(round(sides["left"] * width))
        right = int(round(sides["right"] * width))

        # Rounding can collapse a thin box, and clamping keeps the crop inside the
        # thumbnail even when the browser reports a box a fraction past the edge.
        top = max(0, min(top, height - 1))
        left = max(0, min(left, width - 1))
        bottom = max(top + 1, min(bottom, height))
        right = max(left + 1, min(right, width))

        if right - left < cls.MIN_SIDE_PIXELS or bottom - top < cls.MIN_SIDE_PIXELS:
            return None, (
                f"the box is too small; each side has to be at least "
                f"{cls.MIN_SIDE_PIXELS} pixels of the photo's big thumbnail"
            )

        return (top, right, bottom, left), None


class DeleteFaces(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=FaceIdsRequest)
    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        data = parse_body(request, FaceIdsRequest)
        faces = Face.objects.owned_by(user).in_bulk(data["face_ids"])

        deleted: list[str] = []
        not_deleted: list[str] = []
        for face in faces.values():
            deleted.append(face.image.url)
            face.deleted = True
            face.save()

        # A deleted face keeps its person (reads filter on ``deleted``), so the
        # person's count and cover have to be recomputed, as on relabeling.
        deleted_ids = set(faces)
        affected_person_ids = {f.person_id for f in faces.values() if f.person_id}
        # _calculate_face_count needs the owner; a legacy ownerless person is
        # left as it is rather than failing the delete.
        for person in Person.objects.filter(
            id__in=affected_person_ids, cluster_owner__isnull=False
        ):
            if person.cover_face_id in deleted_ids:
                person.cover_face = None
                person.cover_photo = None
            person._calculate_face_count()
            person._set_default_cover_photo()

        # Search indexes the names of the people on a photo, so a deleted
        # face's person kept matching it until the next rescan.
        # Face.photo is nullable; Django ignores a null id in an __in lookup,
        # so leaving it out does not change which photos are found.
        labeled_photo_ids = {
            f.photo_id for f in faces.values() if f.person_id and f.photo_id is not None
        }
        if labeled_photo_ids:
            photos = (
                Photo.objects.owned_by(user)
                .filter(pk__in=labeled_photo_ids)
                .select_related("main_file", "metadata", "caption_instance")
                .prefetch_related(
                    "files",
                    Prefetch("faces", queryset=Face.objects.select_related("person")),
                )
            )
            recreate_search_captions(list(photos))

        return Response(
            {
                "status": True,
                "results": deleted,
                "not_deleted": not_deleted,
                "deleted": deleted,
            }
        )
