from datetime import datetime

import numpy as np
import requests
from django.core.paginator import Paginator

from api import sidecars
from api.http_timeouts import SIMILARITY
from api.models import Photo
from api.util import logger

# Embeddings per request of an index rebuild.
INDEX_PAGE_SIZE = 5000


def search_similar_embedding(user, emb, result_count=100, threshold=27):
    if isinstance(user, int):
        user_id = user
    else:
        user_id = user.id

    image_embedding = np.array(emb, dtype=np.float32)

    post_data = {
        "user_id": user_id,
        "image_embedding": image_embedding.tolist(),
        "n": result_count,
        "threshold": threshold,
    }
    try:
        res = sidecars.post(
            "image_similarity", "/search/", json=post_data, timeout=SIMILARITY
        )
    except requests.HTTPError as error:
        logger.error(
            f"error retrieving similar embeddings for user {user_id}: "
            f"{sidecars.error_detail(error)}"
        )
        return []
    return res.json()["result"]


def search_similar_image(user, photo, threshold=27):
    if isinstance(user, int):
        user_id = user
    else:
        user_id = user.id

    clip_embeddings = photo.get_clip_embeddings()
    if clip_embeddings is None:
        return []

    image_embedding = np.array(clip_embeddings, dtype=np.float32)

    post_data = {
        "user_id": user_id,
        "image_embedding": image_embedding.tolist(),
        "threshold": threshold,
    }
    try:
        res = sidecars.post(
            "image_similarity", "/search/", json=post_data, timeout=SIMILARITY
        )
    except requests.HTTPError as error:
        logger.error(
            f"error retrieving similar photos to {photo.image_hash} belonging to "
            f"user {user_id}: {sidecars.error_detail(error)}"
        )
        return []
    return res.json()


class SimilarityIndexError(RuntimeError):
    """The similarity sidecar did not take a page of the index rebuild."""


def build_image_similarity_index(user):
    """Rebuild the user's similarity index from their CLIP embeddings.

    The pages go to the sidecar as one rebuild: the first carries ``begin``,
    the last ``commit``, and the sidecar swaps the new index in only after
    the last one, so searches keep answering from the old index meanwhile and
    a failed rebuild leaves it in place. Raises SimilarityIndexError when the
    sidecar refuses or misses a page.
    """
    logger.info(f"building similarity index for user {user.username}")
    start = datetime.now()
    photos = (
        Photo.objects.owned_by(user)
        .filter(hidden=False)
        .exclude(clip_embeddings=None)
        .only("clip_embeddings", "image_hash")
        .order_by("image_hash")
        .all()
    )
    # An empty queryset still has one (empty) page, so a user without
    # embeddings gets an empty index rather than keeping a stale one.
    paginator = Paginator(photos, INDEX_PAGE_SIZE)
    last_page = paginator.num_pages

    index_size = 0
    for page in range(1, last_page + 1):
        image_hashes = []
        image_embeddings = []
        for photo in paginator.page(page).object_list:
            clip_embeddings = photo.get_clip_embeddings()
            if clip_embeddings is not None:
                image_hashes.append(photo.image_hash)
                image_embedding = np.array(clip_embeddings, dtype=np.float32)
                image_embeddings.append(image_embedding.tolist())

        post_data = {
            "user_id": user.id,
            "image_hashes": image_hashes,
            "image_embeddings": image_embeddings,
            "begin": page == 1,
            "commit": page == last_page,
        }
        index_size = _post_build_page(user, page, last_page, post_data)
    elapsed = (datetime.now() - start).total_seconds()
    logger.info(
        "building similarity index of %d photos took %.2f seconds", index_size, elapsed
    )
    return index_size


def _post_build_page(user, page, last_page, post_data):
    where = f"page {page} of {last_page} of the similarity index of {user.username}"
    try:
        body = sidecars.post(
            "image_similarity", "/build/", json=post_data, timeout=SIMILARITY
        ).json()
    except (requests.RequestException, ValueError) as error:
        raise SimilarityIndexError(
            f"{where} failed: {sidecars.error_detail(error)}"
        ) from error
    if not isinstance(body, dict) or body.get("status") is not True:
        raise SimilarityIndexError(f"{where} was refused: {body!r}")
    return body.get("index_size", 0)
