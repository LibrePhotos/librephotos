import numpy as np
import requests
from django.conf import settings


MULTIMODAL_INFERENCE_URL = settings.MULTIMODAL_INFERENCE_SERVER


def create_clip_embeddings(imgs):
    response = requests.post(
        f"{MULTIMODAL_INFERENCE_URL}/semantic-embeddings/image",
        json={"imgs": imgs},
    )
    clip_embeddings = response.json()

    imgs_emb = clip_embeddings["imgs_emb"]
    magnitudes = clip_embeddings["magnitudes"]

    # Convert Python lists to NumPy arrays
    imgs_emb = [np.array(enc) for enc in imgs_emb]

    return imgs_emb, magnitudes


def calculate_query_embeddings(query):
    response = requests.post(
        f"{MULTIMODAL_INFERENCE_URL}/semantic-embeddings/text",
        json={"query": query},
    )
    query_embedding = response.json()

    emb = query_embedding["emb"]
    magnitude = query_embedding["magnitude"]
    return emb, magnitude
