from datetime import datetime

import numpy as np
import requests
from django.conf import settings
from django.core.paginator import Paginator
from django.db.models import Q

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
    res = requests.post(settings.IMAGE_SIMILARITY_SERVER + "/search/", json=post_data)
    if res.status_code == 200:
        return res.json()["result"]
    else:
        logger.error(f"error retrieving similar embeddings for user {user_id}")
        return []


def search_similar_image(user, photo, threshold=27):
    if isinstance(user, int):
        user_id = user
    else:
        user_id = user.id

    if photo.clip_embeddings is None:
        return []

    image_embedding = np.array(photo.clip_embeddings, dtype=np.float32)

    post_data = {
        "user_id": user_id,
        "image_embedding": image_embedding.tolist(),
        "threshold": threshold,
    }
    res = requests.post(settings.IMAGE_SIMILARITY_SERVER + "/search/", json=post_data)
    if res.status_code == 200:
        return res.json()
    else:
        logger.error(
            f"error retrieving similar photos to {photo.image_hash} belonging to user {user.username}"
        )
        return []


def build_image_similarity_index(user):
    logger.info(f"building similarity index for user {user.username}")
    requests.delete(
        settings.IMAGE_SIMILARITY_SERVER + "/build/",
        json={"user_id": user.id},
    )
    start = datetime.now()
    photos = (
        Photo.objects.filter(Q(hidden=False) & Q(owner=user))
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
            image_hashes.append(photo.image_hash)
            image_embedding = np.array(photo.clip_embeddings, dtype=np.float32)
            image_embeddings.append(image_embedding.tolist())

        post_data = {
            "user_id": user.id,
            "image_hashes": image_hashes,
            "image_embeddings": image_embeddings,
        }
        requests.post(settings.IMAGE_SIMILARITY_SERVER + "/build/", json=post_data)
    elapsed = (datetime.now() - start).total_seconds()
    logger.info("building similarity index took %.2f seconds" % elapsed)
