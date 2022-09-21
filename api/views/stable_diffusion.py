import os
import uuid
from datetime import datetime

import pytz
from diffusers import StableDiffusionPipeline
from django_rq import job
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView
from torch import autocast

import ownphotos.settings
from api.models import LongRunningJob
from api.util import logger


@job
def generate_image(user, job_id, prompt):
    if LongRunningJob.objects.filter(job_id=job_id).exists():
        lrj = LongRunningJob.objects.get(job_id=job_id)
        lrj.started_at = datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()
    else:
        lrj = LongRunningJob.objects.create(
            started_by=user,
            job_id=job_id,
            queued_at=datetime.now().replace(tzinfo=pytz.utc),
            started_at=datetime.now().replace(tzinfo=pytz.utc),
            job_type=LongRunningJob.JOB_GENERATE_PHOTO,
        )
        lrj.save()
    try:

        pipe = StableDiffusionPipeline.from_pretrained("/stable-diffusion")

        # improve speed by deactivating check
        def dummy_checker(images, **kwargs):
            return images, False

        pipe.safety_checker = dummy_checker

        pipe = pipe.to("cpu")

        with autocast("cpu"):
            image = pipe(prompt)["sample"][0]

        # save image in folder /generated and renamed it if it already exists
        if not os.path.exists(os.path.join(user.scan_directory, "generated")):
            os.mkdir(os.path.join(user.scan_directory, "generated"))
        if not os.path.exists(
            os.path.join(user.scan_directory, "generated", prompt + ".jpg")
        ):
            photo_path = os.path.join(user.scan_directory, "generated", prompt + ".jpg")
        else:
            image_hash = uuid.uuid4().hex
            photo_path = os.path.join(
                user.scan_directory, "generated", image_hash + ".jpg"
            )

        image_path = os.path.join(ownphotos.settings.BASE_LOGS, prompt + ".jpg")
        image.save(photo_path)

        logger.info("Picture is in {}".format(image_path))
        lrj.finished = True
        lrj.finished_at = datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()
        logger.info("job {}: updated lrj entry to db".format(job_id))

    except Exception:
        logger.exception("An error occured")
        lrj.failed = True
        lrj.finished = True
        lrj.finished_at = datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()

    return 1


# This API View calls generate image and returns the job id and has a query prompt parameter
class StableDiffusionView(APIView):
    @extend_schema(
        parameters=[
            OpenApiParameter("prompt", OpenApiTypes.STR),
        ],
    )
    def get(self, request, format=None):
        job_id = uuid.uuid4()
        prompt = request.query_params.get("prompt")
        generate_image.delay(request.user, job_id, prompt)
        return Response({"job_id": job_id})
