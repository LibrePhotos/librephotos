"""Moving the requester's photos to another folder of their library (#352),
or into folders by their capture date (#2774)."""

import logging
from dataclasses import asdict
from typing import Any

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.drf.exceptions import Conflict, NameConflict
from api.drf.params import parse_body, parse_query
from api.drf.request_user import request_user
from api.jobs.queue import JobStep
from api.jobs.start import enqueue_for_request
from api.models import LongRunningJob, Photo
from api.models.user import User
from api.photos import moves
from api.photos.files import OnConflict
from api.photos.selection import selected_photos
from api.serializers.photo_moves import (
    LibraryFolderListingSerializer,
    MoveFolderQuery,
    MovePhotosRequest,
    MovePhotosResponse,
    MovePhotosStartedResponse,
    MovePreviewRequest,
    MovePreviewResponse,
)

logger = logging.getLogger(__name__)

#: How many clashing names the 409's message lists.
LISTED_CLASHES = 10


def _target(user: User, target_folder: str) -> str:
    """``moves.resolve_target``, its refusal as a 400 on ``target_folder``."""
    try:
        return moves.resolve_target(user, target_folder)
    except moves.InvalidTargetError as error:
        raise ValidationError({"target_folder": str(error)}, code=error.code) from error


def selection_to_move(user: User, data: dict[str, Any]) -> list[Photo]:
    """The requester's own selected photos, in the order they move; at most ``MOVE_LIMIT``."""
    photos = selected_photos(user, data)
    if photos.count() > moves.MOVE_LIMIT:
        raise ValidationError(
            f"At most {moves.MOVE_LIMIT} photos move at once.", code="too_many_photos"
        )
    return moves.photos_to_move(user, list(photos.values_list("pk", flat=True)))


def _plan(
    user: User, base: str, photos: list[Photo], data: dict[str, Any]
) -> moves.MovePlan:
    """Where ``photos`` go: ``base``, or with ``folder_pattern`` the folders
    of their dates in it. A dated target outside the library or in a folder
    the scan skips is a 400 on ``folder_pattern``."""
    try:
        return moves.plan_move(user, base, photos, data.get("folder_pattern"))
    except moves.InvalidTargetError as error:
        raise ValidationError(
            {"folder_pattern": str(error)}, code=error.code
        ) from error


def refused_counts(refused: dict[str, int]) -> list[dict[str, Any]]:
    return [{"reason": reason, "photos": count} for reason, count in refused.items()]


def _preview_body(target: str, preview: moves.MovePreview) -> dict[str, Any]:
    return {
        "target_folder": target,
        "photos": preview.photos,
        "files": preview.files,
        "unchanged": preview.unchanged,
        "refused": refused_counts(preview.refused),
        "clashes": [asdict(clash) for clash in preview.clashes],
        "undated": preview.undated,
        "undated_hashes": preview.undated_hashes,
        "folders": [asdict(folder) for folder in preview.folders],
    }


def _name_conflict(preview: moves.MovePreview) -> NameConflict:
    names = [clash.name for clash in preview.clashes]
    listed = ", ".join(names[:LISTED_CLASHES])
    more = len(names) - LISTED_CLASHES
    if more > 0:
        listed += f" and {more} more"
    return NameConflict(
        f"{len(names)} photos have a name that is taken in the folder: {listed}. "
        'Send on_conflict "rename" or "skip".',
        len(names),
    )


class MovePhotosPreviewView(APIView):
    """What moving the selected photos to ``target_folder`` would do: the
    photos and files that move, those already there or refused, and each name
    that is taken there with the name "rename" would give it. With
    ``folder_pattern`` also the photos without a date and each folder they go
    to. A POST because a selection can be a whole query; it changes nothing."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=MovePreviewRequest, responses=MovePreviewResponse)
    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        data = parse_body(request, MovePreviewRequest)
        target = _target(user, data["target_folder"])
        plan = _plan(user, target, selection_to_move(user, data), data)
        preview = moves.preview_move(plan, dated=bool(data.get("folder_pattern")))
        return Response(_preview_body(target, preview))


class MovePhotosView(APIView):
    """Move the selected photos, with all their files, to ``target_folder``.

    Only the requester's own photos, only inside their library folders.
    With ``folder_pattern`` each photo goes into the folder of its capture
    date inside ``target_folder``; photos without a date stay (``undated``).
    Without ``on_conflict`` a taken name is a 409 ``name_conflict`` and
    nothing moves. Up to ``SYNC_MOVE_LIMIT`` photos move within the request
    (200 with the counts); more queue the "Move Photos" job (202). A scan of
    the library running meanwhile is a 409 ``scan_running``: it reads the
    paths a move changes.
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=MovePhotosRequest,
        responses={200: MovePhotosResponse, 202: MovePhotosStartedResponse},
    )
    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        data = parse_body(request, MovePhotosRequest)
        target = _target(user, data["target_folder"])
        photos = selection_to_move(user, data)
        plan = _plan(user, target, photos, data)
        if moves.scan_running(user):
            raise Conflict(
                "A scan of your library is running; move the photos after it.",
                code="scan_running",
            )
        if "on_conflict" not in data:
            preview = moves.preview_move(plan)
            if preview.clashes:
                raise _name_conflict(preview)
        # Without a choice no clash was found; one appearing meanwhile is
        # skipped, never overwritten.
        chosen: OnConflict = "rename" if data.get("on_conflict") == "rename" else "skip"
        if plan.photo_count > moves.SYNC_MOVE_LIMIT:
            return self._start_job(user, photos, target, data, chosen)
        result = moves.move_photos(plan, chosen)
        logger.info(
            "Moved %s photos for user %s (%s skipped, %s failed).",
            result.moved,
            user.id,
            result.skipped,
            result.failed,
        )
        return Response({"target_folder": target, **result.as_dict()})

    def _start_job(
        self,
        user: User,
        photos: list[Photo],
        target: str,
        data: dict[str, Any],
        on_conflict: OnConflict,
    ) -> Response:
        [job] = enqueue_for_request(
            user,
            [
                JobStep(
                    LongRunningJob.JOB_MOVE_PHOTOS,
                    moves.move_photos_job,
                    (
                        user,
                        [photo.pk for photo in photos],
                        moves.Destination(target, data.get("folder_pattern") or None),
                        on_conflict,
                    ),
                )
            ],
            "moving photos",
        )
        return Response(
            {"job_id": job.job_id, "target_folder": target},
            status=status.HTTP_202_ACCEPTED,
        )


class MoveFoldersView(APIView):
    """The folders of the requester's library a move can go to, one level at
    a time: without ``path`` the library folders (scan directory, upload
    folder), with it the subfolders of that folder. Folders the scan skips
    are left out. A ``path`` outside the library is a 400, checked before
    anything about it is read."""

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[MoveFolderQuery], responses=LibraryFolderListingSerializer
    )
    def get(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        path = parse_query(request, MoveFolderQuery).get("path")
        try:
            listing = moves.library_folders(user, path)
        except moves.InvalidTargetError as error:
            raise ValidationError({"path": str(error)}, code=error.code) from error
        return Response(asdict(listing))
