import numpy as np
import requests
from django.db.models import Q

from api.models import Photo
from api.util import logger
from ownphotos.settings import IMAGE_SIMILARITY_SERVER


def search_similar_embedding(user, emb, result_count=100, threshold=27):
    if type(user) == int:
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
    res = requests.post(IMAGE_SIMILARITY_SERVER + "/search/", json=post_data)
    if res.status_code == 200:
        return res.json()["result"]
    else:
        logger.error("error retrieving similar embeddings for user {}".format(user_id))
        return []


def search_similar_image(user, photo):
    if type(user) == int:
        user_id = user
    else:
        user_id = user.id

    if photo.clip_embeddings is None:
        photo._generate_clip_embeddings()
    if photo.clip_embeddings is None:
        return []

    image_embedding = np.array(photo.clip_embeddings, dtype=np.float32)

    post_data = {"user_id": user_id, "image_embedding": image_embedding.tolist()}
    res = requests.post(IMAGE_SIMILARITY_SERVER + "/search/", json=post_data)
    if res.status_code == 200:
        return res.json()
    else:
        logger.error(
            "error retrieving similar photos to {} belonging to user {}".format(
                photo.image_hash, user.username
            )
        )
        return []


def build_image_similarity_index(user):
    logger.info("builing similarity index for user {}".format(user.username))
    photos = (
        Photo.objects.filter(Q(hidden=False) & Q(owner=user))
        .exclude(clip_embeddings=None)
        .only("clip_embeddings")[:2500]
    )

    image_hashes = []
    image_embeddings = []

    for photo in photos:
        image_hashes.append(photo.image_hash)
        image_embedding = np.array(photo.clip_embeddings, dtype=np.float32)
        image_embeddings.append(image_embedding.tolist())

    post_data = {
        "user_id": user.id,
        "image_hashes": image_hashes,
        "image_embeddings": image_embeddings,
    }
    res = requests.post(IMAGE_SIMILARITY_SERVER + "/build/", json=post_data)
    return res.json()
