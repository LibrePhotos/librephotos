import logging
import uuid
from typing import Any

import PIL.Image
from django.conf import settings
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
from django.utils import timezone
from django_q.tasks import Chain
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.directory_watcher import generate_face_embeddings, scan_faces
from api.face_classify import cluster_all_faces
from api.ml_models import do_all_models_exist, download_models
from api.models import Face, Photo, User
from api.models.person import Person, get_or_create_person
from api.models.photo_search import PhotoSearch
from api.models.thumbnail import Thumbnail
from api.photo_faces import overlaps_existing_face, save_detected_face
from api.request_data import request_dict
from api.request_user import request_user
from api.serializers.face import (
    FaceListSerializer,
    IncompletePersonFaceListSerializer,
    PersonFaceListSerializer,
)
from api.views.custom_api_view import ListViewSet
from api.views.pagination import RegularResultsSetPagination
from api.views.photos import _get_photo_filter_kwargs
from api.views.scan_triggers import start_job

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
        if not settings.FEATURE_FACE_DETECTION:
            return Response(
                {"status": False, "message": "Face detection is disabled"},
                status=status.HTTP_403_FORBIDDEN,
            )

        user = request_user(request)

        def enqueue(job_id: uuid.UUID) -> None:
            chain = Chain()
            if not do_all_models_exist():
                chain.append(download_models, user)
            chain.append(scan_faces, user, job_id, True)
            chain.run()

        return start_job(enqueue, "the face scan")


class TrainFaceView(APIView):
    permission_classes = (IsAuthenticated,)

    @staticmethod
    def _train_faces(request: Request) -> Response:
        if not settings.FEATURE_FACE_CLUSTER:
            return Response(
                {"status": False, "message": "Face clustering is disabled"},
                status=status.HTTP_403_FORBIDDEN,
            )
        user = request_user(request)
        chain = Chain()
        if not do_all_models_exist():
            chain.append(download_models, user)
        try:
            job_id = uuid.uuid4()
            chain.append(generate_face_embeddings, user, uuid.uuid4())
            chain.append(cluster_all_faces, user, job_id)
            chain.run()
            return Response({"status": True, "job_id": job_id})
        except Exception:
            logger.exception("Failed to queue face training")
            return Response({"status": False})

    def post(self, request: Request, format: str | None = None) -> Response:
        return self._train_faces(request)


class FaceListView(ListViewSet):
    permission_classes = (IsAuthenticated,)
    serializer_class = PersonFaceListSerializer
    pagination_class = RegularResultsSetPagination

    def get_queryset(self) -> QuerySet[Face]:
        # drf-spectacular asks with an anonymous request; photo__owner rejects it.
        if getattr(self, "swagger_fake_view", False):
            return Face.objects.none()
        personid: str | None = self.request.query_params.get("person", "0")

        if personid == "0":
            personid = None

        analysis_method: str | None = self.request.query_params.get(
            "analysis_method", "clustering"
        )
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
        inferred = self.request.query_params.get("inferred", "").lower() == "true"
        analysis_method = self.request.query_params.get("analysis_method", "clustering")
        min_confidence = float(self.request.query_params.get("min_confidence", 0))

        queryset = Person.objects.filter(cluster_owner=user)
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
                            & Q(classification_faces__photo__owner=user),
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
                            & Q(cluster_faces__photo__owner=user),
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
                        Q(faces__deleted=False) & Q(faces__photo__owner=user),
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
    def list(self, *args: Any, **kwargs: Any) -> Response:
        user = request_user(self.request)
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
                    & Q(photo__owner=user)
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
                    & Q(photo__owner=user),
                ).count()
        else:
            unknown_faces_count = Face.objects.filter(
                person=None, deleted=False, photo__owner=user
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
    permission_classes = (IsAuthenticated,)

    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        data = dict(request_dict(request))
        person: Person | None = None
        cluster_person: Person | None = None
        classification_person: Person | None = None
        # Person.name carries a MinLengthValidator, but get_or_create() does not run
        # field validators, so a blank name would quietly create a nameless person
        # and an album to go with it. Surrounding whitespace is trimmed for the same
        # reason: " Bob " would otherwise become a second person next to "Bob".
        person_name = (data.get("person_name") or "").strip()
        if not person_name:
            return Response(
                {"status": False, "message": "person_name must not be empty"},
                status=status.HTTP_400_BAD_REQUEST,
            )
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
            if Person.objects.filter(
                name=person_name,
                cluster_owner=user,
                kind__in=(Person.KIND_CLUSTER, Person.KIND_UNKNOWN),
            ).exists():
                return Response(
                    {
                        "status": False,
                        "message": (
                            f'"{person_name}" is the label of a face cluster, not a '
                            "person. Name the face instead of confirming the cluster."
                        ),
                    },
                    status=status.HTTP_400_BAD_REQUEST,
                )
            person = get_or_create_person(
                name=person_name, owner=user, kind=Person.KIND_USER
            )

        # Everything the loop below touches is pulled in up front: the ownership
        # check needs the photo and its owner, rebuilding the search captions
        # needs the caption, metadata and file rows. Fetching them lazily costs
        # several queries per face, which is what makes tagging a large
        # selection of faces run into the gateway timeout.
        # Only the requester's own faces are loaded: a foreign face id must
        # not come back serialized in ``not_updated`` (it carried the photo id
        # and the face crop path of someone else's photo).
        faces = (
            Face.objects.filter(photo__owner=user)
            .select_related(
                "photo__owner",
                "photo__main_file",
                "photo__metadata",
                "photo__caption_instance",
            )
            .prefetch_related(
                "photo__files",
                Prefetch(
                    "photo__faces",
                    queryset=Face.objects.select_related("person"),
                ),
            )
            .in_bulk(data["face_ids"])
        )

        updated = []
        not_updated: list[dict[str, object]] = []
        relabeled_faces = []
        affected_person_ids = set()
        for face in faces.values():
            if face.person_id is not None:
                affected_person_ids.add(face.person_id)
            face.person = person
            if not person:
                face.cluster_person = cluster_person
                face.classification_person = classification_person
            relabeled_faces.append(face)
            updated.append(FaceListSerializer(face).data)
        Face.objects.bulk_update(
            relabeled_faces, ["person", "cluster_person", "classification_person"]
        )
        if person:
            affected_person_ids.add(person.id)
        for affected_person in Person.objects.filter(id__in=affected_person_ids):
            affected_person._calculate_face_count()
            affected_person._set_default_cover_photo()

        # Every photo we relabeled needs its captions rebuilt, not just the one
        # the loop happened to end on.
        updated_photos: dict[uuid.UUID, Photo] = {}
        for face in relabeled_faces:
            # Selected by photo__owner above, so every face has its photo.
            assert face.photo is not None
            updated_photos[face.photo.pk] = face.photo

        # The faces behind `photo.faces` were prefetched before the relabel, so
        # those cached rows still carry the old person. They are different
        # instances from the ones we just updated, so copy the new person across
        # before rebuilding the captions from them.
        relabeled_by_pk = {face.pk: face for face in relabeled_faces}
        for photo in updated_photos.values():
            for cached_face in photo.faces.all():
                relabeled = relabeled_by_pk.get(cached_face.pk)
                if relabeled is not None:
                    cached_face.person = relabeled.person

        self._recreate_search_captions(list(updated_photos.values()))

        # Write face regions to image files if user preference is enabled
        if user.save_face_tags_to_disk:
            use_sidecar = user.save_metadata_to_disk == User.SaveMetadata.SIDECAR_FILE
            for photo in updated_photos.values():
                try:
                    photo._save_metadata(
                        use_sidecar=use_sidecar,
                        metadata_types=["face_tags"],
                    )
                except Exception:
                    logger.exception(
                        f"Failed to write face tags for photo {photo.image_hash}"
                    )

        return Response(
            {
                "status": True,
                "results": updated,
                "updated": updated,
                "not_updated": not_updated,
            }
        )

    @staticmethod
    def _recreate_search_captions(photos: list[Photo]) -> None:
        """Rebuild the search captions of the given photos in one batch.

        Doing a ``get_or_create()`` and a ``save()`` per photo would put the
        query count of the request back into the thousands.
        """
        search_instances = PhotoSearch.objects.in_bulk([photo.pk for photo in photos])

        to_create: list[PhotoSearch] = []
        to_update: list[PhotoSearch] = []
        for photo in photos:
            search_instance = search_instances.get(photo.pk)
            if search_instance:
                # Reuse the photo we already have instead of selecting it again.
                search_instance.photo = photo
                search_instance.updated_at = timezone.now()
                to_update.append(search_instance)
            else:
                search_instance = PhotoSearch(photo=photo)
                to_create.append(search_instance)
            search_instance.recreate_search_captions()

        # Two clients labelling faces on the same photo can race to create its
        # search row, so fall back to updating the row the other one won with.
        PhotoSearch.objects.bulk_create(
            to_create,
            update_conflicts=True,
            update_fields=["search_captions", "updated_at"],
            unique_fields=["photo"],
        )
        PhotoSearch.objects.bulk_update(to_update, ["search_captions", "updated_at"])


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

    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        person_name = (request_dict(request).get("person_name") or "").strip()
        if not person_name:
            return self._error("person_name must not be empty")
        if person_name == Person.UNKNOWN_PERSON_NAME:
            return self._error(
                "a face drawn by hand has to name someone; "
                f"'{Person.UNKNOWN_PERSON_NAME}' is what the algorithms use"
            )

        photo_id = request_dict(request).get("photo")
        if not photo_id:
            return self._error("photo is required")
        photo = (
            Photo.objects.owned_by(user)
            .filter(**_get_photo_filter_kwargs(str(photo_id)))
            .select_related(
                "owner", "thumbnail", "main_file", "metadata", "caption_instance"
            )
            .prefetch_related("files", "faces__person")
            .first()
        )
        if photo is None:
            return Response(
                {"status": False, "message": "photo not found"},
                status=status.HTTP_404_NOT_FOUND,
            )

        thumbnail_path = self._thumbnail_path(photo)
        if thumbnail_path is None:
            return self._error(
                "this photo has no big thumbnail yet, so there is nothing to "
                "measure the box against"
            )

        try:
            big_thumbnail = PIL.Image.open(thumbnail_path)
        except OSError:
            logger.exception(f"Cannot open thumbnail for photo {photo.image_hash}")
            return self._error("this photo's thumbnail cannot be read")

        with big_thumbnail:
            box, error = self._box_in_pixels(
                request_dict(request).get("box"),
                big_thumbnail.width,
                big_thumbnail.height,
            )
            if error:
                return self._error(error)
            # _box_in_pixels returns a box whenever it reports no error.
            assert box is not None
            top, right, bottom, left = box

            existing = photo.faces.filter(deleted=False).values_list(
                "location_top", "location_right", "location_bottom", "location_left"
            )
            if overlaps_existing_face(existing, top, right, bottom, left):
                return Response(
                    {
                        "status": False,
                        "message": "there is already a face here; label that one "
                        "instead of adding a second face over it",
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            face_image = big_thumbnail.crop((left, top, right, bottom))
            person = get_or_create_person(
                name=person_name, owner=user, kind=Person.KIND_USER
            )
            face = save_detected_face(
                photo,
                face_image,
                f"{photo.image_hash}_manual_{uuid.uuid4().hex[:8]}.jpg",
                person,
                None,
                (top, right, bottom, left),
            )

        # Without an encoding the face is still a valid label -- it just cannot be
        # compared to anything yet. "Train faces" encodes faces that have none, so
        # a face service that is down or disabled delays recognition rather than
        # losing the user's work.
        try:
            face.generate_encoding()
        except Exception:
            logger.exception(
                f"Could not encode manually added face {face.id}; "
                "it will be encoded by the next face training run"
            )

        person._calculate_face_count()
        person._set_default_cover_photo()

        # The person's name is part of what the photo can be found by.
        photo.refresh_from_db()
        SetFacePersonLabel._recreate_search_captions([photo])

        if user.save_face_tags_to_disk:
            use_sidecar = user.save_metadata_to_disk == User.SaveMetadata.SIDECAR_FILE
            try:
                photo._save_metadata(
                    use_sidecar=use_sidecar, metadata_types=["face_tags"]
                )
            except Exception:
                logger.exception(
                    f"Failed to write face tags for photo {photo.image_hash}"
                )

        return Response(
            {
                "status": True,
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
    def _error(message: str) -> Response:
        return Response(
            {"status": False, "message": message}, status=status.HTTP_400_BAD_REQUEST
        )

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

    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        data = dict(request_dict(request))
        faces = Face.objects.filter(photo__owner=user).in_bulk(data["face_ids"])

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
            SetFacePersonLabel._recreate_search_captions(list(photos))

        return Response(
            {
                "status": True,
                "results": deleted,
                "not_deleted": not_deleted,
                "deleted": deleted,
            }
        )
