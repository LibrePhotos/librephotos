import os
import uuid
from datetime import datetime

import pytz
from constance import config as site_config
from django.db.models import Q
from django_q.tasks import AsyncTask

import api.util as util
from api.image_similarity import build_image_similarity_index
from api.ml_models import download_models
from api.models.long_running_job import LongRunningJob
from api.models.photo import Photo
from api.semantic_search.semantic_search import semantic_search_instance


def create_batch_job(job_type, user):
    job_id = uuid.uuid4()
    lrj = LongRunningJob.objects.create(
        started_by=user,
        job_id=job_id,
        queued_at=datetime.now().replace(tzinfo=pytz.utc),
        job_type=job_type,
    )

    if job_type == LongRunningJob.JOB_CALCULATE_CLIP_EMBEDDINGS:
        AsyncTask(batch_calculate_clip_embedding, job_id, user).run()
    if job_type == LongRunningJob.JOB_DOWNLOAD_MODELS:
        AsyncTask(download_models, job_id).run()

    lrj.save()


def batch_calculate_clip_embedding(job_id, user):
    import torch

    lrj = LongRunningJob.objects.get(job_id=job_id)
    lrj.started_at = datetime.now().replace(tzinfo=pytz.utc)

    count = Photo.objects.filter(
        Q(owner=user) & Q(clip_embeddings__isnull=True)
    ).count()
    lrj.result = {"progress": {"current": 0, "target": count}}
    lrj.save()
    if not torch.cuda.is_available():
        num_threads = max(1, site_config.HEAVYWEIGHT_PROCESS)
        torch.set_num_threads(num_threads)
        os.environ["OMP_NUM_THREADS"] = str(num_threads)
    else:
        torch.multiprocessing.set_start_method("spawn", force=True)

    BATCH_SIZE = 64
    util.logger.info("Using threads: {}".format(torch.get_num_threads()))

    done_count = 0
    while done_count < count:
        try:
            objs = list(
                Photo.objects.filter(Q(owner=user) & Q(clip_embeddings__isnull=True))[
                    :BATCH_SIZE
                ]
            )
            done_count += len(objs)

            if len(objs) == 0:
                break
            valid_objs = []
            for obj in objs:
                # Thumbnail could have been deleted
                if obj.thumbnail_big and os.path.exists(obj.thumbnail_big.path):
                    valid_objs.append(obj)
            imgs = list(map(lambda obj: obj.thumbnail_big.path, valid_objs))
            if len(valid_objs) == 0:
                continue

            imgs_emb, magnitudes = semantic_search_instance.calculate_clip_embeddings(
                imgs
            )

            for obj, img_emb, magnitude in zip(valid_objs, imgs_emb, magnitudes):
                obj.clip_embeddings = img_emb.tolist()
                obj.clip_embeddings_magnitude = magnitude
                obj.save()
        except Exception as e:
            util.logger.error("Error calculating clip embeddings: {}".format(e))
        lrj.result = {"progress": {"current": done_count, "target": count}}
        lrj.save()

    semantic_search_instance.unload()
    build_image_similarity_index(user)
    lrj.finished_at = datetime.now().replace(tzinfo=pytz.utc)
    lrj.finished = True
    lrj.save()
