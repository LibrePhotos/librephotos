import numpy as np
from django.conf import settings

from api import sidecars
from api.http_timeouts import CLIP_EMBED

dir_clip_ViT_B_32_model = settings.CLIP_ROOT


def create_clip_embeddings(imgs):
    """CLIP embeddings for image paths, one slot per path.

    Raises ``requests.HTTPError`` when the sidecar answers with an error, rather
    than a ``KeyError`` from reading its error reply as embeddings.
    """
    json = {
        "imgs": imgs,
        "model": dir_clip_ViT_B_32_model,
    }
    clip_embeddings = sidecars.post(
        "clip_embeddings", "/clip-embeddings", json=json, timeout=CLIP_EMBED
    ).json()

    imgs_emb = clip_embeddings["imgs_emb"]
    magnitudes = clip_embeddings["magnitudes"]

    # One slot per requested image; the sidecar sends null for an image it
    # could not read, and that slot stays None so positions keep lining up.
    imgs_emb = [None if enc is None else np.array(enc) for enc in imgs_emb]

    return imgs_emb, magnitudes


def calculate_query_embeddings(query):
    json = {
        "query": query,
        "model": dir_clip_ViT_B_32_model,
    }
    query_embedding = sidecars.post(
        "clip_embeddings", "/query-embeddings", json=json, timeout=CLIP_EMBED
    ).json()

    emb = query_embedding["emb"]
    magnitude = query_embedding["magnitude"]
    return emb, magnitude
