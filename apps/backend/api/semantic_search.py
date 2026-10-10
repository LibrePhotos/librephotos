"""Semantic search and similar photos: which model embeds, and where it runs.

Two models can produce the embeddings (site setting ``SEMANTIC_SEARCH_MODEL``):

``mobileclip_s2`` (default)
    MobileCLIP-S2, also the default tagging model. It runs in the ``tags``
    sidecar, and when it is the tagging model too the tags job stores the
    embedding of the very run that tagged the photo (``semantic_shares_tagger``),
    so a scan runs one vision model per photo and the 600 MB CLIP ViT-B/32 is
    never loaded or downloaded. The Rust backend experiment measured its scan
    stage 17.5 % faster and its peak memory 615 MB lower this way, and search
    quality on 30 labelled queries equal or better.
``clip_vit_b32``
    CLIP ViT-B/32 in the ``clip_embeddings`` sidecar, the only model before.

Both give 512-dimensional embeddings, stored unnormalised. The similarity
index ranks by inner product, and the raw scales differ (ViT-B/32 image and
text norms around 10; MobileCLIP-S2 image ~1, text ~9), so the thresholds
follow the model. MobileCLIP's were calibrated to return as many photos per
query (search) and per photo (similar photos) as ViT-B/32's 27 and 90.

Every embedding records the model that produced it in
``Photo.clip_embeddings_model``; NULL means CLIP ViT-B/32, the model of every
embedding stored before the column existed. Search, the index and similar
photos only use the selected model's embeddings, and the Calculate CLIP
embeddings job replaces the other model's in place: switching models never
drops an embedding, and search keeps working on the photos already converted.
"""

from django.conf import settings
from django.db.models import Q

from api import sidecars
from api.http_timeouts import CLIP_EMBED
from api.lazy_import import LazyModule

np = LazyModule("numpy")

MOBILECLIP_S2 = "mobileclip_s2"
CLIP_VIT_B32 = "clip_vit_b32"
SEMANTIC_SEARCH_MODELS = (MOBILECLIP_S2, CLIP_VIT_B32)
DEFAULT_SEMANTIC_SEARCH_MODEL = MOBILECLIP_S2
# The model of an embedding whose clip_embeddings_model is NULL.
LEGACY_SEMANTIC_SEARCH_MODEL = CLIP_VIT_B32

# Inner-product cuts: text search, and "similar photos" in the photo detail.
SEARCH_THRESHOLDS = {CLIP_VIT_B32: 27.0, MOBILECLIP_S2: 1.84}
SIMILAR_THRESHOLDS = {CLIP_VIT_B32: 90.0, MOBILECLIP_S2: 0.71}

# The sidecar that runs each model.
_SIDECARS = {CLIP_VIT_B32: "clip_embeddings", MOBILECLIP_S2: "tags"}

dir_clip_ViT_B_32_model = settings.CLIP_ROOT


def semantic_search_model():
    """The selected model; an unknown or unreadable value means the default."""
    try:
        from constance import config as site_config

        value = str(site_config.SEMANTIC_SEARCH_MODEL or "").strip()
    except Exception:
        # A database that is not up yet (or a test without one).
        return DEFAULT_SEMANTIC_SEARCH_MODEL
    return value if value in SEMANTIC_SEARCH_MODELS else DEFAULT_SEMANTIC_SEARCH_MODEL


def semantic_shares_tagger():
    """Whether the tags job also produces the search embeddings."""
    from constance import config as site_config

    return (
        settings.FEATURE_SCENE_CLASSIFICATION
        and semantic_search_model() == MOBILECLIP_S2
        and site_config.TAGGING_MODEL == MOBILECLIP_S2
    )


def produced_by(model, prefix=""):
    """A ``Q`` for photos whose stored embedding comes from ``model``."""
    field = f"{prefix}clip_embeddings_model"
    q = Q(**{field: model})
    if model == LEGACY_SEMANTIC_SEARCH_MODEL:
        q |= Q(**{f"{field}__isnull": True})
    return q


def embedding_model_of(photo):
    """The model of a photo's stored embedding."""
    return photo.clip_embeddings_model or LEGACY_SEMANTIC_SEARCH_MODEL


def search_threshold(model=None):
    return SEARCH_THRESHOLDS[model or semantic_search_model()]


def similar_threshold(model=None):
    return SIMILAR_THRESHOLDS[model or semantic_search_model()]


def _request(model, path, json):
    if model == CLIP_VIT_B32:
        json = {**json, "model": dir_clip_ViT_B_32_model}
    return sidecars.post(_SIDECARS[model], path, json=json, timeout=CLIP_EMBED)


def create_clip_embeddings(imgs, model=None):
    """Embeddings for image paths, one slot per path, and their magnitudes.

    Raises ``requests.HTTPError`` when the sidecar answers with an error, rather
    than a ``KeyError`` from reading its error reply as embeddings.
    """
    clip_embeddings = _request(
        model or semantic_search_model(), "/clip-embeddings", {"imgs": imgs}
    ).json()

    imgs_emb = clip_embeddings["imgs_emb"]
    magnitudes = clip_embeddings["magnitudes"]

    # One slot per requested image; the sidecar sends null for an image it
    # could not read, and that slot stays None so positions keep lining up.
    imgs_emb = [None if enc is None else np.array(enc) for enc in imgs_emb]

    return imgs_emb, magnitudes


def calculate_query_embeddings(query, model=None):
    query_embedding = _request(
        model or semantic_search_model(), "/query-embeddings", {"query": query}
    ).json()

    emb = query_embedding["emb"]
    magnitude = query_embedding["magnitude"]
    return emb, magnitude
