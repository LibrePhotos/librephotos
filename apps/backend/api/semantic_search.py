import numpy as np
import requests
from django.conf import settings

from api import marengo
from api.http_timeouts import CLIP_EMBED

dir_clip_ViT_B_32_model = settings.CLIP_ROOT


def create_clip_embeddings(imgs, video_flags=None):
    # Opt-in: route image/video embedding through TwelveLabs Marengo when
    # selected. ``video_flags`` (parallel to ``imgs``) lets video items be
    # embedded as whole clips; defaults to all-image when not provided.
    if marengo.is_enabled():
        if video_flags is None:
            video_flags = [False] * len(imgs)
        return marengo.create_embeddings(imgs, video_flags)

    json = {
        "imgs": imgs,
        "model": dir_clip_ViT_B_32_model,
    }
    clip_embeddings = requests.post(
        "http://localhost:8006/clip-embeddings", json=json, timeout=CLIP_EMBED
    ).json()

    imgs_emb = clip_embeddings["imgs_emb"]
    magnitudes = clip_embeddings["magnitudes"]

    # Convert Python lists to NumPy arrays
    imgs_emb = [np.array(enc) for enc in imgs_emb]

    return imgs_emb, magnitudes


def calculate_query_embeddings(query):
    # Opt-in: queries must be embedded by the same provider that embedded the
    # media, otherwise the vectors live in different spaces and search breaks.
    if marengo.is_enabled():
        return marengo.embed_text(query)

    json = {
        "query": query,
        "model": dir_clip_ViT_B_32_model,
    }
    query_embedding = requests.post(
        "http://localhost:8006/query-embeddings", json=json, timeout=CLIP_EMBED
    ).json()

    emb = query_embedding["emb"]
    magnitude = query_embedding["magnitude"]
    return emb, magnitude
