import numpy as np
import requests
from django.conf import settings

dir_clip_ViT_B_32_model = settings.CLIP_ROOT


def create_clip_embeddings(imgs):
    json = {
        "imgs": imgs,
        "model": dir_clip_ViT_B_32_model,
    }
    clip_embeddings = requests.post(
        "http://localhost:8006/clip-embeddings", json=json
    ).json()

    imgs_emb = clip_embeddings["imgs_emb"]
    magnitudes = clip_embeddings["magnitudes"]

    # Convert Python lists to NumPy arrays
    imgs_emb = [np.array(enc) for enc in imgs_emb]

    return imgs_emb, magnitudes


def calculate_query_embeddings(query):
    json = {
        "query": query,
        "model": dir_clip_ViT_B_32_model,
    }
    query_embedding = requests.post(
        "http://localhost:8006/query-embeddings", json=json
    ).json()

    emb = query_embedding["emb"]
    magnitude = query_embedding["magnitude"]
    return emb, magnitude
