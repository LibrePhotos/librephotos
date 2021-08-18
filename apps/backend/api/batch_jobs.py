import torch
import uuid

from datetime import datetime
import pytz

from api.models.photo import Photo
from api.models.long_running_job import LongRunningJob
from api.semantic_search.semantic_search import semantic_search_instance

from django_rq import job


def create_batch_job(job_type, user):
    job_id = uuid.uuid4()
    lrj = LongRunningJob.objects.create(
        started_by=user,
        job_id=job_id,
        queued_at=datetime.now().replace(tzinfo=pytz.utc),
        job_type=job_type,
    )

    if job_type == LongRunningJob.JOB_CALCULATE_CLIP_EMBEDDINGS:
        batch_calculate_clip_embedding.delay(job_id)

    lrj.save()


@job
def batch_calculate_clip_embedding(job_id):
    lrj = LongRunningJob.objects.get(job_id=job_id)
    lrj.started_at = datetime.now().replace(tzinfo=pytz.utc)

    count = Photo.objects.filter(clip_embeddings__isnull=True).count()
    lrj.result = {"progress": {"current": 0, "target": count}}
    lrj.save()

    BATCH_SIZE = 64
    print(f"Using threads: {str(torch.get_num_threads())}")

    try:
        done_count = 0
        while done_count < count:
            objs = list(Photo.objects.filter(clip_embeddings__isnull=True)[:BATCH_SIZE])
            imgs = list(map(lambda obj: obj.image_paths[0], objs))

            if len(objs) == 0:
                break

            imgs_emb, magnitudes = semantic_search_instance.calculate_clip_embeddings(
                imgs
            )

            for obj, img_emb, magnitude in zip(objs, imgs_emb, magnitudes):
                obj.clip_embeddings = img_emb.tolist()
                obj.clip_embeddings_magnitude = magnitude
                obj.save()
                done_count += 1

            lrj.result = {"progress": {"current": done_count, "target": count}}
            lrj.save()

        semantic_search_instance.unload()

        lrj.finished_at = datetime.now().replace(tzinfo=pytz.utc)
        lrj.finished = True
        lrj.save()

    except Exception as e:
        print(e)
