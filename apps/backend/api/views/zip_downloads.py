"""Zip downloads: start an archive job, poll it, delete the archive."""

import logging
import shutil
import uuid

from django.conf import settings
from django.db.models import Sum
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.all_tasks import create_download_job, delete_zip_file, zip_file_name
from api.drf.exceptions import InsufficientStorage
from api.drf.params import parse_body, parse_query
from api.drf.request_user import request_user
from api.models import LongRunningJob, Photo
from api.serializers.zip_download import ZipDownloadRequest, ZipDownloadStatusQuery

logger = logging.getLogger(__name__)


def _free_space_for_archives() -> int:
    """Free bytes on the file system the archive is written to.

    That is MEDIA_ROOT's, which in the images is a volume of its own rather
    than the container's root file system.
    """
    try:
        return shutil.disk_usage(settings.MEDIA_ROOT).free
    except OSError:
        return shutil.disk_usage("/").free


class ZipListPhotosView_V2(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=ZipDownloadRequest)
    def post(self, request: Request) -> Response:
        from api.views.photo_filters import build_photo_queryset

        user = request_user(request)
        free_storage = _free_space_for_archives()
        data = parse_body(request, ZipDownloadRequest)
        include_stacked = data["include_stacked_photos"]

        photo_query = Photo.objects.owned_by(user)

        # Two payload shapes are accepted, mirroring the other bulk mutations
        # (SetPhotosDeleted, SetFavoritePhotos, SetPhotosHidden, SetPhotosPublic):
        # an explicit `image_hashes` list, or `select_all=True` plus a `query`
        # describing the photoset the user is looking at, with optional
        # `excluded_hashes` for items they unchecked.
        if data["select_all"]:
            photos = build_photo_queryset(user, data["query"])
            if data["excluded_hashes"]:
                photos = photos.exclude(image_hash__in=data["excluded_hashes"])
        else:
            photos = photo_query.filter(image_hash__in=data["image_hashes"])

        if not photos.exists():
            raise NotFound("No photos found")

        # Optionally expand to include all photos from the same stacks
        if include_stacked:
            stack_ids = (
                photos.exclude(stacks__isnull=True)
                .values_list("stacks__id", flat=True)
                .distinct()
            )
            if stack_ids:
                stacked_photos = photo_query.filter(stacks__id__in=stack_ids)
                photos = (photos | stacked_photos).distinct()

        # Calculate the total file size using aggregate
        total_file_size = photos.aggregate(Sum("size"))["size__sum"] or 0
        if free_storage < total_file_size:
            raise InsufficientStorage()
        file_uuid = uuid.uuid4()
        filename = zip_file_name(file_uuid, user.id)

        job_id = create_download_job(user=user, photos=list(photos), filename=filename)
        response = {"job_id": job_id, "url": file_uuid}

        return Response(data=response)

    @extend_schema(parameters=[ZipDownloadStatusQuery])
    def get(self, request: Request) -> Response:
        job_id = parse_query(request, ZipDownloadStatusQuery)["job_id"]
        # Only the user who started the download may poll it (see api/views/jobs.py).
        job = (
            LongRunningJob.objects.owned_by(request_user(request))
            .filter(job_id=job_id)
            .first()
        )
        if job is None:
            raise NotFound()
        # A failed or cancelled job is finished too, so it is asked first; it
        # used to be reported as SUCCESS. 200 rather than 500: the job failed,
        # not this request, and the web client reads the status from the body
        # while its fetch client shows an error toast for every 500 it polls.
        if job.failed or job.cancelled:
            return Response(data={"status": "FAILURE", "result": job.result})
        if job.finished:
            return Response(data={"status": "SUCCESS"})
        return Response(
            data={"status": "PENDING", "progress": job.result},
            status=status.HTTP_202_ACCEPTED,
        )


class DeleteZipView(APIView):
    permission_classes = (IsAuthenticated,)

    def delete(self, request: Request, fname: str) -> Response:
        # The archive is named after the authenticated requester, so a user can
        # only ever name their own file; fname itself must be the job's UUID.
        filename = zip_file_name(fname, request_user(request).id)
        if filename is None:
            raise NotFound()
        try:
            delete_zip_file(filename)
            return Response()
        except BaseException as e:
            logger.error(str(e))
            raise NotFound() from e
