import os


from api import util
from api.image_similarity import build_image_similarity_index
from api.models.long_running_job import LongRunningJob
from api.models.photo import Photo
from api.semantic_search import create_clip_embeddings


def photos_missing_clip_embeddings(user):
    return Photo.objects.owned_by(user).filter(clip_embeddings__isnull=True)


def photos_with_existing_thumbnail(objs):
    # Thumbnail could have been deleted, or never made (no Thumbnail row)
    return [
        obj
        for obj in objs
        if (thumbnail := getattr(obj, "thumbnail", None))
        and thumbnail.thumbnail_big
        and os.path.exists(thumbnail.thumbnail_big.path)
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

    missing = (
        photos_missing_clip_embeddings(user).select_related("thumbnail").order_by("pk")
    )
    count = missing.count()
    lrj.update_progress(current=0, target=count)

    BATCH_SIZE = 64
    done_count = 0
    last_pk = None
    while done_count < count:
        batch = missing if last_pk is None else missing.filter(pk__gt=last_pk)
        objs = list(batch[:BATCH_SIZE])
        if not objs:
            break
        # Page past this batch whatever happens to it. A photo that gets no
        # embedding (no thumbnail, unreadable for the sidecar, a failed call)
        # still matches the filter, and taking the first BATCH_SIZE again
        # would hand it the head of every batch until the run ended.
        last_pk = objs[-1].pk
        done_count += len(objs)

        try:
            valid_objs = photos_with_existing_thumbnail(objs)
            if valid_objs:
                store_clip_embeddings(valid_objs)
        except Exception as e:
            util.logger.error(f"Error calculating clip embeddings: {e}")

        lrj.update_progress(current=done_count, target=count)

    try:
        build_image_similarity_index(user)
    except Exception as e:
        # The embeddings are stored; only the index is stale. Say so rather
        # than report a job that left similar-photo search behind as done.
        util.logger.error(f"Error building the similarity index: {e}")
        lrj.fail(e)
        raise
    lrj.complete()
