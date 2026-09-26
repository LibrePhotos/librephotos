from datetime import datetime

import numpy as np
import requests
from django.core.paginator import Paginator

from api import sidecars
from api.http_timeouts import SIMILARITY
from api.models import Photo
from api.util import logger


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


def build_image_similarity_index(user):
    logger.info(f"building similarity index for user {user.username}")
    sidecars.http.delete(
        sidecars.sidecar_url("image_similarity", "/build/"),
        json={"user_id": user.id},
        timeout=SIMILARITY,
    )
    start = datetime.now()
    photos = (
        Photo.objects.owned_by(user)
        .filter(hidden=False)
        .exclude(clip_embeddings=None)
        .only("clip_embeddings", "image_hash")
        .order_by("image_hash")
        .all()
    )
    paginator = Paginator(photos, 5000)

    for page in range(1, paginator.num_pages + 1):
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
        }
        sidecars.http.post(
            sidecars.sidecar_url("image_similarity", "/build/"),
            json=post_data,
            timeout=SIMILARITY,
        )
    elapsed = (datetime.now() - start).total_seconds()
    logger.info("building similarity index took %.2f seconds", elapsed)
