import os

from django.db.models import Q

from api import util
from api.image_similarity import build_image_similarity_index
from api.models.long_running_job import LongRunningJob
from api.models.photo import Photo
from api.semantic_search import create_clip_embeddings


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
        if img_emb is None:
            # The sidecar could not read this thumbnail; leave the photo for
            # a later run rather than storing somebody else's embedding.
            util.logger.warning(
                f"No CLIP embedding for {obj.image_hash}: unreadable thumbnail"
            )
            continue
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
