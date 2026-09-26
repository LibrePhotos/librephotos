"""Zip downloads: start an archive job, poll it, delete the archive."""

import uuid

from django.db.models import Sum
from rest_framework.response import Response
from rest_framework.views import APIView

from api.all_tasks import create_download_job, delete_zip_file, zip_file_name
from api.models import LongRunningJob, Photo
from api.util import logger


class ZipListPhotosView_V2(APIView):
    def post(self, request):
        import shutil

        from api.views.photo_filters import build_photo_queryset

        free_storage = shutil.disk_usage("/").free
        data = request.data

        include_stacked = data.get("include_stacked_photos", False)
        if isinstance(include_stacked, (list, tuple)):
            include_stacked = include_stacked[0] if include_stacked else False
        if isinstance(include_stacked, str):
            include_stacked = include_stacked.strip().lower() in (
                "1",
                "true",
                "yes",
                "on",
            )
        include_stacked = bool(include_stacked)

        photo_query = Photo.objects.owned_by(self.request.user)

        # Two payload shapes are accepted, mirroring the other bulk mutations
        # (SetPhotosDeleted, SetFavoritePhotos, SetPhotosHidden, SetPhotosPublic):
        # an explicit `image_hashes` list, or `select_all=True` plus a `query`
        # describing the photoset the user is looking at, with optional
        # `excluded_hashes` for items they unchecked.
        if data.get("select_all"):
            query_params = data.get("query") or {}
            if isinstance(query_params, (list, tuple)):
                query_params = query_params[0] if query_params else {}
            excluded_hashes = data.get("excluded_hashes") or []
            if isinstance(excluded_hashes, str):
                excluded_hashes = [excluded_hashes]

            photos = build_photo_queryset(self.request.user, query_params)
            if excluded_hashes:
                photos = photos.exclude(image_hash__in=excluded_hashes)
        else:
            image_hashes = data.get("image_hashes")
            if not image_hashes:
                return Response(data={"error": "image_hashes required"}, status=400)

            # DRF may provide list values (QueryDict) or a single string
            if isinstance(image_hashes, str):
                image_hashes = [image_hashes]
            elif isinstance(image_hashes, (list, tuple)):
                # QueryDict -> dict() would produce list values, request.data keeps list too
                pass
            else:
                image_hashes = list(image_hashes)

            photos = photo_query.filter(image_hash__in=image_hashes)

        if not photos.exists():
            return Response(data={"error": "No photos found"}, status=404)

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
            return Response(data={"status": "Insufficient Storage"}, status=507)
        file_uuid = uuid.uuid4()
        filename = zip_file_name(file_uuid, self.request.user.id)

        job_id = create_download_job(
            LongRunningJob.JOB_DOWNLOAD_PHOTOS,
            user=self.request.user,
            photos=list(photos),
            filename=filename,
        )
        response = {"job_id": job_id, "url": file_uuid}

        return Response(data=response, status=200)

    def get(self, request):
        job_id = request.GET.get("job_id")
        if not job_id:
            return Response(data={"error": "job_id is required"}, status=400)
        # Only the user who started the download may poll it (see api/views/jobs.py).
        job = LongRunningJob.objects.filter(
            job_id=job_id, started_by=request.user
        ).first()
        if job is None:
            return Response(status=404)
        if job.finished:
            return Response(data={"status": "SUCCESS"}, status=200)
        if job.failed:
            return Response(
                data={"status": "FAILURE", "result": job.result}, status=500
            )
        return Response(data={"status": "PENDING", "progress": job.result}, status=202)


class DeleteZipView(APIView):
    def delete(self, request, fname):
        # The archive is named after the authenticated requester, so a user can
        # only ever name their own file; fname itself must be the job's UUID.
        filename = zip_file_name(fname, request.user.id)
        if filename is None:
            return Response(status=404)
        try:
            delete_zip_file(filename)
            return Response(status=200)
        except BaseException as e:
            logger.error(str(e))
            return Response(status=404)
