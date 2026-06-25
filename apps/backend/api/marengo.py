"""TwelveLabs Marengo embedding provider (opt-in).

Marengo produces 512-dimensional embeddings in a single multimodal space, so
image, video and text embeddings are directly comparable. When this provider
is selected (``config.EMBEDDING_PROVIDER == "twelvelabs_marengo"``) it replaces
the local CLIP/SigLIP model behind ``api.semantic_search``: images, *full
videos* and text queries are all embedded by Marengo and indexed in the same
FAISS index, keeping similarity and semantic search internally consistent.

Unlike the local model, which embeds a single still thumbnail for video items,
Marengo embeds the whole clip via its asynchronous video-embedding task API,
giving genuine video understanding for video Photos.

Get a free API key at https://twelvelabs.io (generous free tier). The key is
configured at runtime via the ``TWELVELABS_API_KEY`` site setting (Constance),
never hard-coded.
"""

import numpy as np
from constance import config as site_config

from api import util

# Marengo embeddings are fixed at 512 dimensions, matching the local CLIP model
# already used elsewhere, so no FAISS / schema changes are needed.
MARENGO_MODEL_NAME = "marengo3.0"
MARENGO_EMBED_DIM = 512

# Reuse the single segment that covers the whole clip. For video we request the
# "video" scope (one embedding per file); for image/text there is one segment.
_VIDEO_SCOPE = ["video"]

_client = None


def is_enabled():
    """True when Marengo is the selected embedding provider and a key is set."""
    return getattr(
        site_config, "EMBEDDING_PROVIDER", "local"
    ) == "twelvelabs_marengo" and bool(getattr(site_config, "TWELVELABS_API_KEY", ""))


def _get_client():
    """Lazily build a cached TwelveLabs client from the configured API key."""
    global _client
    if _client is None:
        from twelvelabs import TwelveLabs

        api_key = getattr(site_config, "TWELVELABS_API_KEY", "")
        if not api_key:
            raise RuntimeError(
                "TWELVELABS_API_KEY is not set; cannot use the Marengo provider"
            )
        _client = TwelveLabs(api_key=api_key)
    return _client


def _vector_and_magnitude(float_list):
    emb = np.array(float_list, dtype=np.float32)
    magnitude = float(np.linalg.norm(emb))
    return emb.tolist(), magnitude


def embed_text(query):
    """Return ``(embedding_list, magnitude)`` for a text query (512-dim)."""
    resp = _get_client().embed.create(model_name=MARENGO_MODEL_NAME, text=query)
    segment = resp.text_embedding.segments[0]
    return _vector_and_magnitude(segment.float_)


def embed_image(image_path):
    """Return ``(embedding_list, magnitude)`` for a still image (512-dim)."""
    with open(image_path, "rb") as f:
        resp = _get_client().embed.create(model_name=MARENGO_MODEL_NAME, image_file=f)
    segment = resp.image_embedding.segments[0]
    return _vector_and_magnitude(segment.float_)


def embed_video(video_path):
    """Return ``(embedding_list, magnitude)`` for a whole video file (512-dim).

    Video embedding is asynchronous: a task is created and polled to
    completion, then the file-level ("video" scope) embedding is retrieved.
    """
    client = _get_client()
    with open(video_path, "rb") as f:
        task = client.embed.tasks.create(
            model_name=MARENGO_MODEL_NAME,
            video_file=f,
            video_embedding_scope=_VIDEO_SCOPE,
        )
    task = client.embed.tasks.wait_for_done(task_id=task.id)
    if task.status != "ready":
        raise RuntimeError(
            f"Marengo video embedding task {task.id} ended with status {task.status}"
        )
    retrieved = client.embed.tasks.retrieve(task_id=task.id)
    # We requested only the "video" scope, so there is a single file-level
    # segment covering the whole clip.
    segment = retrieved.video_embedding.segments[0]
    return _vector_and_magnitude(segment.float_)


def create_embeddings(paths, video_flags):
    """Embed a batch of media paths via Marengo.

    ``paths`` and ``video_flags`` are parallel lists; a truthy flag embeds the
    whole video, otherwise the still image is embedded. Mirrors the return
    shape of ``api.semantic_search.create_clip_embeddings``:
    ``(list_of_np_arrays, list_of_magnitudes)``.
    """
    embeddings = []
    magnitudes = []
    for path, is_video in zip(paths, video_flags):
        try:
            if is_video:
                emb, magnitude = embed_video(path)
            else:
                emb, magnitude = embed_image(path)
        except Exception as e:
            util.logger.error(f"Marengo embedding failed for {path}: {e}")
            raise
        embeddings.append(np.array(emb, dtype=np.float32))
        magnitudes.append(magnitude)
    return embeddings, magnitudes
