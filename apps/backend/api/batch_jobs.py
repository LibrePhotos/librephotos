import os

from django.db.models import Q

from api import util
from api.image_similarity import build_image_similarity_index
from api.models.long_running_job import LongRunningJob
from api.models.photo import Photo
from api.semantic_search import create_clip_embeddings


def configure_torch_runtime():
    import torch

    if not torch.cuda.is_available():
        num_threads = 1
        torch.set_num_threads(num_threads)
        os.environ["OMP_NUM_THREADS"] = str(num_threads)
    else:
        torch.multiprocessing.set_start_method("spawn", force=True)
    util.logger.info(f"Using threads: {torch.get_num_threads()}")


def photos_missing_clip_embeddings(user):
    return Photo.objects.filter(Q(owner=user) & Q(clip_embeddings__isnull=True))


def photos_with_existing_thumbnail(objs):
    # Thumbnail could have been deleted
    return [
        obj
        for obj in objs
        if obj.thumbnail.thumbnail_big
        and os.path.exists(obj.thumbnail.thumbnail_big.path)
    ]


def store_clip_embeddings(objs):
    imgs = [obj.thumbnail.thumbnail_big.path for obj in objs]
    imgs_emb, magnitudes = create_clip_embeddings(imgs)

    for obj, img_emb, magnitude in zip(objs, imgs_emb, magnitudes):
        obj.clip_embeddings = img_emb.tolist()
        obj.clip_embeddings_magnitude = magnitude
        obj.save()


def batch_calculate_clip_embedding(user):
    lrj = LongRunningJob.create_job(
        user=user,
        job_type=LongRunningJob.JOB_CALCULATE_CLIP_EMBEDDINGS,
        start_now=True,
    )

    count = photos_missing_clip_embeddings(user).count()
    lrj.update_progress(current=0, target=count)

    configure_torch_runtime()

    BATCH_SIZE = 64
    done_count = 0
    while done_count < count:
        try:
            objs = list(photos_missing_clip_embeddings(user)[:BATCH_SIZE])
            done_count += len(objs)

            if len(objs) == 0:
                break
            valid_objs = photos_with_existing_thumbnail(objs)
            if len(valid_objs) == 0:
                continue

            store_clip_embeddings(valid_objs)
        except Exception as e:
            util.logger.error(f"Error calculating clip embeddings: {e}")

        lrj.update_progress(current=done_count, target=count)

    build_image_similarity_index(user)
    lrj.complete()
