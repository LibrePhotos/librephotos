import logging
import os


from django.db.models import Q

from api.image_similarity import build_image_similarity_index
from api.models.long_running_job import LongRunningJob
from api.models.photo import Photo
from api.semantic_search import (
    MOBILECLIP_S2,
    create_clip_embeddings,
    produced_by,
    semantic_search_model,
    semantic_shares_tagger,
)

logger = logging.getLogger(__name__)

# While a run re-embeds photos of the other model, the similarity index is
# rebuilt after this many, so search covers the converted ones as it goes.
INDEX_REBUILD_EVERY = 2000


def photos_missing_clip_embeddings(user, model=None):
    """The user's photos without an embedding of the selected model.

    That includes photos embedded by the other model: they are re-embedded in
    place, never cleared first.
    """
    model = model or semantic_search_model()
    return Photo.objects.owned_by(user).filter(
        Q(clip_embeddings__isnull=True) | ~produced_by(model)
    )


def photos_with_existing_thumbnail(objs):
    # Thumbnail could have been deleted, or never made (no Thumbnail row)
    return [
        obj
        for obj in objs
        if (thumbnail := getattr(obj, "thumbnail", None))
        and thumbnail.thumbnail_big
        and os.path.exists(thumbnail.thumbnail_big.path)
    ]


def store_clip_embeddings(objs, model=None):
    model = model or semantic_search_model()
    imgs = [obj.thumbnail.thumbnail_big.path for obj in objs]
    imgs_emb, magnitudes = create_clip_embeddings(imgs, model)

    for obj, img_emb, magnitude in zip(objs, imgs_emb, magnitudes):
        if img_emb is None:
            # The sidecar could not read this thumbnail; leave the photo for
            # a later run rather than storing somebody else's embedding.
            logger.warning(
                f"No CLIP embedding for {obj.image_hash}: unreadable thumbnail"
            )
            continue
        obj.clip_embeddings = img_emb.tolist()
        obj.clip_embeddings_magnitude = magnitude
        obj.clip_embeddings_model = model
        # Only these columns: ``obj`` was loaded before the sidecar call, and a
        # whole-row save would put back whatever the rest of the row held then.
        obj.save(
            update_fields=[
                "clip_embeddings",
                "clip_embeddings_magnitude",
                "clip_embeddings_model",
                "last_modified",
            ]
        )


def _rebuild_index_while_converting(user):
    try:
        build_image_similarity_index(user)
    except Exception as e:
        # The run goes on; the index is rebuilt again at its end.
        logger.error(f"Error rebuilding the similarity index mid-run: {e}")


def batch_calculate_clip_embedding(user, wait_for_tags=False):
    """Embed the user's photos that lack an embedding of the selected model.

    With ``wait_for_tags`` (the scan's follow-up, when the tags job stores the
    embeddings itself, see ``semantic_shares_tagger``) photos the tagger has
    not reached yet are left to it; the tags job queues this job again when it
    finishes, to fill the gaps and rebuild the index.
    """
    model = semantic_search_model()
    lrj = LongRunningJob.create_job(
        user=user,
        job_type=LongRunningJob.JOB_CALCULATE_CLIP_EMBEDDINGS,
        start_now=True,
    )

    missing = photos_missing_clip_embeddings(user, model)
    if wait_for_tags and semantic_shares_tagger():
        missing = missing.filter(caption_instance__captions_json__has_key=MOBILECLIP_S2)
    missing = missing.select_related("thumbnail").order_by("pk")
    count = missing.count()
    lrj.update_progress(current=0, target=count)

    # Converting from the other model: the live index still holds the old
    # model's embeddings, which the new model's queries cannot be compared
    # with. Rebuild it now (the converted photos, none at first) and as the
    # run goes, so search answers from the new model throughout.
    converting = missing.filter(clip_embeddings__isnull=False).exists()
    if converting:
        logger.info(f"re-embedding photos of {user.username} with {model}")
        _rebuild_index_while_converting(user)
    since_rebuild = 0

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
                store_clip_embeddings(valid_objs, model)
        except Exception as e:
            logger.error(f"Error calculating clip embeddings: {e}")

        lrj.update_progress(current=done_count, target=count)
        since_rebuild += len(objs)
        if converting and since_rebuild >= INDEX_REBUILD_EVERY and done_count < count:
            _rebuild_index_while_converting(user)
            since_rebuild = 0

    try:
        build_image_similarity_index(user)
    except Exception as e:
        # The embeddings are stored; only the index is stale. Say so rather
        # than report a job that left similar-photo search behind as done.
        logger.error(f"Error building the similarity index: {e}")
        lrj.fail(e)
        raise
    lrj.complete()


def queue_semantic_search_conversion():
    """Queue the embedding job for every user with another model's embeddings.

    After the semantic search model changed (an upgrade to MobileCLIP-S2, or a
    switch in the site settings), the job re-embeds those photos in place and
    rebuilds the index as it goes. Returns the ids of the users queued.
    """
    from django_q.tasks import AsyncTask

    from api.models import User

    model = semantic_search_model()
    user_ids = list(
        Photo.objects.filter(clip_embeddings__isnull=False)
        .exclude(produced_by(model))
        .values_list("owner_id", flat=True)
        .distinct()
    )
    for user in User.objects.filter(pk__in=user_ids):
        AsyncTask(batch_calculate_clip_embedding, user).run()
    return user_ids
