"""Semantic search, similar photos and tags: the one image-text model.

LibrePhotos runs OpenCLIP ViT-B/32 (LAION's DataComp-XL weights, MIT licence)
in the ``tags`` sidecar. One image-tower run per photo gives both its tags and
its search embedding: the tags job stores the embedding of the very run that
tagged the photo (``semantic_shares_tagger``), and the Calculate CLIP
embeddings job, which fills the gaps and re-embeds photos of earlier models,
asks for the tags of the same run.

Embeddings are 512-d and stored unnormalised. The similarity index ranks by
inner product, so the thresholds below are on the raw scale of this model's
image and text embeddings (see ``scripts/calibrate_openclip.py``).

Every embedding records the model that produced it in
``Photo.clip_embeddings_model``; NULL is CLIP ViT-B/32, the model of every
embedding stored before the column existed. Search, the index and similar
photos use only this model's embeddings, and the embedding job replaces the
others in place: an upgrade never drops an embedding, and search keeps working
on the photos already converted.
"""

from django.conf import settings
from django.db.models import Q

from api import sidecars
from api.http_timeouts import CLIP_EMBED
from api.lazy_import import LazyModule

np = LazyModule("numpy")

# The model's name: Photo.clip_embeddings_model of its embeddings, the
# captions_json key of its tags and the prefix of its tag albums' thing_type.
OPENCLIP = "openclip_vitb32"
TAG_THING_TYPE = f"{OPENCLIP}_tag"

# Inner-product cuts: text search, and "similar photos" in the photo detail.
SEARCH_THRESHOLD = 31.3
SIMILAR_THRESHOLD = 138.9

SIDECAR = "tags"


def semantic_shares_tagger():
    """Whether the tags job also produces the search embeddings."""
    return bool(settings.FEATURE_SCENE_CLASSIFICATION)


def produced_by_openclip(prefix=""):
    """A ``Q`` for photos whose stored embedding comes from this model."""
    return Q(**{f"{prefix}clip_embeddings_model": OPENCLIP})


def is_current_embedding(photo):
    """Whether a photo's stored embedding can be compared with the index."""
    return photo.clip_embeddings_model == OPENCLIP


def create_clip_embeddings(imgs, with_tags=False):
    """Embeddings for image paths, one slot per path, their magnitudes, and
    (``with_tags``) the tags of the same run, else None.

    Raises ``requests.HTTPError`` when the sidecar answers with an error, rather
    than a ``KeyError`` from reading its error reply as embeddings.
    """
    body = {"imgs": imgs}
    if with_tags:
        body["with_tags"] = True
    clip_embeddings = sidecars.post(
        SIDECAR, "/clip-embeddings", json=body, timeout=CLIP_EMBED
    ).json()

    imgs_emb = clip_embeddings["imgs_emb"]
    magnitudes = clip_embeddings["magnitudes"]

    # One slot per requested image; the sidecar sends null for an image it
    # could not read, and that slot stays None so positions keep lining up.
    imgs_emb = [None if enc is None else np.array(enc) for enc in imgs_emb]

    return imgs_emb, magnitudes, clip_embeddings.get("tags")


def calculate_query_embeddings(query):
    query_embedding = sidecars.post(
        SIDECAR, "/query-embeddings", json={"query": query}, timeout=CLIP_EMBED
    ).json()

    emb = query_embedding["emb"]
    magnitude = query_embedding["magnitude"]
    return emb, magnitude
