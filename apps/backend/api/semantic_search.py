import numpy as np
import requests
from django.conf import settings

from api.http_timeouts import CLIP_EMBED
from api.sidecars import sidecar_url

dir_clip_ViT_B_32_model = settings.CLIP_ROOT


def create_clip_embeddings(imgs):
    json = {
        "imgs": imgs,
        "model": dir_clip_ViT_B_32_model,
    }
    clip_embeddings = requests.post(
        sidecar_url(8006, "/clip-embeddings"), json=json, timeout=CLIP_EMBED
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
    query_embedding = requests.post(
        sidecar_url(8006, "/query-embeddings"), json=json, timeout=CLIP_EMBED
    ).json()

    emb = query_embedding["emb"]
    magnitude = query_embedding["magnitude"]
    return emb, magnitude
