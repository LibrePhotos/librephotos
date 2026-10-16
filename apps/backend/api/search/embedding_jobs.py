import logging
import os
import uuid
from collections.abc import Iterable

from django.db.models import Q, QuerySet

from api.jobs.queue import enqueue_followup
from api.models.long_running_job import JobCancelledError, LongRunningJob
from api.models.photo import Photo
from api.models.user import User
from api.search.semantic import (
    OPENCLIP,
    create_clip_embeddings,
    produced_by_openclip,
    semantic_shares_tagger,
)
from api.search.similarity import SimilarityIndexError, build_image_similarity_index

logger = logging.getLogger(__name__)

# While a run re-embeds photos of an earlier model, the similarity index is
# rebuilt after this many, so search covers the converted ones as it goes.
INDEX_REBUILD_EVERY = 2000

# Photos per sidecar request.
BATCH_SIZE = 64


def photos_missing_clip_embeddings(user: User) -> QuerySet[Photo]:
    """The user's photos without an OpenCLIP embedding.

    That includes photos embedded by an earlier model: they are re-embedded in
    place, never cleared first.
    """
    return Photo.objects.owned_by(user).filter(
        Q(clip_embeddings__isnull=True) | ~produced_by_openclip()
    )


def photos_with_existing_thumbnail(objs: Iterable[Photo]) -> list[Photo]:
    # Thumbnail could have been deleted, or never made (no Thumbnail row)
    return [
        obj
        for obj in objs
        if (thumbnail := getattr(obj, "thumbnail", None))
        and thumbnail.thumbnail_big
        and os.path.exists(thumbnail.thumbnail_big.path)
    ]


def _store_tags_if_missing(photo: Photo, tags: Iterable[str]) -> None:
    """File the tags of the embedding run for a photo the tagger has not done.

    Re-embedding after an upgrade re-tags the library in the same image-tower
    run; a photo that already carries OpenCLIP tags keeps them.
    """
    from api.models.photo_caption import PhotoCaption

    caption, _ = PhotoCaption.objects.get_or_create(photo=photo)
    if (caption.captions_json or {}).get(OPENCLIP) is not None:
        return
    caption.store_tags(tags)


def store_clip_embeddings(objs: list[Photo], with_tags: bool = False) -> None:
    imgs = [obj.thumbnail.thumbnail_big.path for obj in objs]
    imgs_emb, magnitudes, tags = create_clip_embeddings(imgs, with_tags=with_tags)
    tags = tags or [None] * len(objs)

    for obj, img_emb, magnitude, photo_tags in zip(objs, imgs_emb, magnitudes, tags):
        if img_emb is None:
            # The sidecar could not read this thumbnail; leave the photo for
            # a later run rather than storing somebody else's embedding.
            logger.warning(
                "No CLIP embedding for %s: unreadable thumbnail", obj.image_hash
            )
            continue
        obj.clip_embeddings = img_emb.tolist()
        obj.clip_embeddings_magnitude = magnitude
        obj.clip_embeddings_model = OPENCLIP
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
        if photo_tags is not None:
            try:
                _store_tags_if_missing(obj, photo_tags)
            except Exception:
                logger.exception("Could not store the tags of %s", obj.image_hash)


def _rebuild_index_while_converting(user: User) -> None:
    try:
        build_image_similarity_index(user)
    except SimilarityIndexError as e:
        # The run goes on; the index is rebuilt again at its end.
        logger.error("Error rebuilding the similarity index mid-run: %s", e)


def batch_calculate_clip_embedding(
    user: User, wait_for_tags: bool = False, job_id: str | None = None
) -> None:
    """Embed the user's photos that lack an OpenCLIP embedding.

    With ``wait_for_tags`` (the scan's follow-up, when the tags job stores the
    embeddings itself, see ``semantic_shares_tagger``) photos the tagger has
    not reached yet are left to it; the tags job queues this job again when it
    finishes, to fill the gaps and rebuild the index. When tagging is on, the
    photos embedded here get the tags of the same run if they have none, so
    re-embedding a library after an upgrade re-tags it too.
    """
    lrj = LongRunningJob.claim(
        user, LongRunningJob.JOB_CALCULATE_CLIP_EMBEDDINGS, job_id
    )
    if lrj is None:
        return

    with_tags = semantic_shares_tagger()
    missing = photos_missing_clip_embeddings(user)
    if wait_for_tags and with_tags:
        missing = missing.filter(caption_instance__captions_json__has_key=OPENCLIP)
    missing = missing.select_related("thumbnail").order_by("pk")
    count = missing.count()
    lrj.update_progress(current=0, target=count)

    # Converting from an earlier model: the live index still holds its
    # embeddings, which OpenCLIP's queries cannot be compared with. Rebuild it
    # now (the converted photos, none at first) and as the run goes, so search
    # answers from OpenCLIP throughout.
    converting = missing.filter(clip_embeddings__isnull=False).exists()
    if converting:
        logger.info("re-embedding photos of user %s with %s", user.id, OPENCLIP)
        _rebuild_index_while_converting(user)

    try:
        _embed_batches(user, lrj, missing, converting, with_tags)
    except JobCancelledError:
        # What was embedded so far is stored; the next run picks up the rest
        # and rebuilds the index then. Mid-conversion the index only answers
        # from the photos converted so far, so it takes those in now.
        logger.info("Search embeddings job %s was cancelled", lrj.job_id)
        if converting:
            _rebuild_index_while_converting(user)
        return

    try:
        build_image_similarity_index(user)
    except Exception as e:
        # The embeddings are stored; only the index is stale. Say so rather
        # than report a job that left similar-photo search behind as done.
        logger.error("Error building the similarity index: %s", e)
        lrj.fail(e)
        raise
    lrj.complete()


def _embed_batches(
    user: User,
    lrj: LongRunningJob,
    missing: QuerySet[Photo],
    converting: bool,
    with_tags: bool,
) -> None:
    """Embed ``missing`` in batches, reporting progress on ``lrj``.

    Raises ``JobCancelledError`` between batches once the job was cancelled.
    """
    count = lrj.progress_target
    since_rebuild = 0
    done_count = 0
    last_pk: uuid.UUID | None = None
    while done_count < count:
        lrj.stop_if_cancelled()
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
                store_clip_embeddings(valid_objs, with_tags=with_tags)
        except Exception:
            # One failed batch (the sidecar down, a bad reply) must not end
            # the run; its photos stay missing and the next run retries them.
            logger.exception("Error calculating clip embeddings")

        lrj.update_progress(current=done_count, target=count)
        since_rebuild += len(objs)
        if converting and since_rebuild >= INDEX_REBUILD_EVERY and done_count < count:
            _rebuild_index_while_converting(user)
            since_rebuild = 0


def photos_with_earlier_embeddings() -> QuerySet[Photo]:
    """Every user's photos whose search embedding comes from an earlier model.

    The semantic search conversion re-embeds them (migration 0152).
    """
    return Photo.objects.filter(clip_embeddings__isnull=False).exclude(
        produced_by_openclip()
    )


def queue_semantic_search_conversion() -> list[int]:
    """Queue the embedding job for every user with an earlier model's embeddings.

    After an upgrade from a release with another search model (migration
    0152), the job re-embeds (and re-tags) those photos in place and rebuilds
    the index as it goes. Returns the ids of the users queued.
    """
    user_ids: list[int] = list(
        photos_with_earlier_embeddings().values_list("owner_id", flat=True).distinct()
    )
    for user in User.objects.filter(pk__in=user_ids):
        enqueue_followup(
            user,
            LongRunningJob.JOB_CALCULATE_CLIP_EMBEDDINGS,
            batch_calculate_clip_embedding,
            user,
        )
    return user_ids
