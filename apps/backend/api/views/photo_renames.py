"""Renaming the requester's photos after their capture date (#2773)."""

import logging
from dataclasses import asdict
from typing import Any

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.drf.exceptions import Conflict
from api.drf.params import parse_body
from api.drf.request_user import request_user
from api.jobs.queue import JobStep
from api.jobs.start import enqueue_for_request
from api.models import LongRunningJob, Photo
from api.models.user import User
from api.photos import moves, renames
from api.serializers.photo_renames import (
    RenamePhotosRequest,
    RenamePhotosResponse,
    RenamePhotosStartedResponse,
    RenamePreviewResponse,
)
from api.views.photo_moves import refused_counts, selection_to_move

logger = logging.getLogger(__name__)


def _preview_body(preview: renames.RenamePreview) -> dict[str, Any]:
    return {
        "photos": preview.photos,
        "files": preview.files,
        "unchanged": preview.unchanged,
        "undated": preview.undated,
        "undated_hashes": preview.undated_hashes,
        "numbered": preview.numbered,
        "no_free_name": preview.no_free_name,
        "refused": refused_counts(preview.refused),
        "rows": [asdict(row) for row in preview.rows],
    }


class RenamePhotosPreviewView(APIView):
    """What renaming the selected photos with ``pattern`` would do: the
    photos and files that get a new name, those that have it already, have
    no capture date or are refused, and the first photos one by one with
    their new names. A POST because a selection can be a whole query; it
    changes nothing."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=RenamePhotosRequest, responses=RenamePreviewResponse)
    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        data = parse_body(request, RenamePhotosRequest)
        photos = selection_to_move(user, data)
        return Response(_preview_body(renames.preview_rename(photos, data["pattern"])))


class RenamePhotosView(APIView):
    """Rename the selected photos, with all their files, to the name
    ``pattern`` makes from each one's capture date.

    Only the requester's own photos; the files stay in their folder. A name
    that is taken gets " (1)", " (2)", ...; nothing is overwritten. Photos
    without a capture date keep their names. Up to ``SYNC_MOVE_LIMIT``
    photos are renamed within the request (200 with the counts); more queue
    the "Rename Photos" job (202). A scan of the library running meanwhile
    is a 409 ``scan_running``: it reads the paths a rename changes.
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=RenamePhotosRequest,
        responses={200: RenamePhotosResponse, 202: RenamePhotosStartedResponse},
    )
    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        data = parse_body(request, RenamePhotosRequest)
        photos = selection_to_move(user, data)
        if moves.scan_running(user):
            raise Conflict(
                "A scan of your library is running; rename the photos after it.",
                code="scan_running",
            )
        if len(photos) > moves.SYNC_MOVE_LIMIT:
            return self._start_job(user, photos, data["pattern"])
        result = renames.rename_photos(photos, data["pattern"])
        logger.info(
            "Renamed %s photos for user %s (%s undated, %s failed).",
            result.renamed,
            user.id,
            result.undated,
            result.failed,
        )
        return Response(result.as_dict())

    def _start_job(self, user: User, photos: list[Photo], pattern: str) -> Response:
        [job] = enqueue_for_request(
            user,
            [
                JobStep(
                    LongRunningJob.JOB_RENAME_PHOTOS,
                    renames.rename_photos_job,
                    (user, [photo.pk for photo in photos], pattern),
                )
            ],
            "renaming photos",
        )
        return Response({"job_id": job.job_id}, status=status.HTTP_202_ACCEPTED)
