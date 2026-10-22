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

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from django.core.exceptions import ObjectDoesNotExist
from django.db.models import Q

from api.lazy_import import LazyModule
from api.runtime import sidecars
from api.runtime.features import feature_enabled
from api.runtime.http_timeouts import CLIP_EMBED

if TYPE_CHECKING:
    import numpy.typing as npt
    from numpy import float64

    from api.models.photo import Photo
    from api.models.photo_caption import PhotoCaption

if TYPE_CHECKING:
    import numpy as np
else:
    np = LazyModule("numpy")

logger = logging.getLogger(__name__)

# The model's name: Photo.clip_embeddings_model of its embeddings, the
# captions_json key of its tags and the prefix of its tag albums' thing_type.
OPENCLIP = "openclip_vitb32"
TAG_THING_TYPE = f"{OPENCLIP}_tag"

# Inner-product cuts: text search, and "similar photos" in the photo detail.
SEARCH_THRESHOLD = 31.3
SIMILAR_THRESHOLD = 138.9

SIDECAR = "tags"


def semantic_shares_tagger() -> bool:
    """Whether the tags job also produces the search embeddings."""
    return feature_enabled("SCENE_CLASSIFICATION")


def produced_by_openclip(prefix: str = "") -> Q:
    """A ``Q`` for photos whose stored embedding comes from this model."""
    return Q(**{f"{prefix}clip_embeddings_model": OPENCLIP})


def is_current_embedding(photo: Photo) -> bool:
    """Whether a photo's stored embedding can be compared with the index."""
    return photo.clip_embeddings_model == OPENCLIP


def create_clip_embeddings(
    imgs: list[str], with_tags: bool = False
) -> tuple[
    list[npt.NDArray[float64] | None], list[float | None], list[list[str] | None] | None
]:
    """Embeddings for image paths, one slot per path, their magnitudes, and
    (``with_tags``) the tags of the same run, else None.

    Raises ``requests.HTTPError`` when the sidecar answers with an error, rather
    than a ``KeyError`` from reading its error reply as embeddings.
    """
    body: dict[str, object] = {"imgs": imgs}
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


def calculate_query_embeddings(query: str | None) -> tuple[list[float], float]:
    query_embedding = sidecars.post(
        SIDECAR, "/query-embeddings", json={"query": query}, timeout=CLIP_EMBED
    ).json()

    emb = query_embedding["emb"]
    magnitude = query_embedding["magnitude"]
    return emb, magnitude


def _needs_tags(caption: PhotoCaption, force: bool = False) -> bool:
    """Whether the photo has a big thumbnail to tag and, unless ``force``,
    no OpenCLIP tags yet."""
    try:
        thumbnail = caption.photo.thumbnail
    except ObjectDoesNotExist:
        return False
    if not thumbnail.thumbnail_big:
        return False
    if force:
        return True
    return caption.captions_json is None or caption.captions_json.get(OPENCLIP) is None


def generate_photo_tags(
    caption: PhotoCaption, commit: bool = True, force: bool = False
) -> None:
    """Tag the photo with OpenCLIP.

    The tags go to ``captions_json[OPENCLIP]`` and the photo's tag albums.
    When tagging feeds semantic search too (``semantic_shares_tagger``),
    the same image-tower run gives the photo's search embedding. Moved out
    of ``PhotoCaption`` so the model makes no sidecar calls (#2336).

    A photo that has OpenCLIP tags is skipped unless ``force`` (Detect things
    again, #2765): then its OpenCLIP tags and tag albums are replaced by the
    new run's. The user's own tags and the other captions stay.
    """
    if not feature_enabled("SCENE_CLASSIFICATION"):
        logger.info("Scene classification is disabled")
        return
    if not _needs_tags(caption, force):
        return

    photo = caption.photo
    try:
        import requests

        from api.runtime.http_timeouts import TAGS

        image_path = photo.thumbnail.thumbnail_big.path
        confidence = photo.owner.confidence
        json_data = {
            "image_path": image_path,
            "confidence": confidence,
            "tagging_model": OPENCLIP,
        }
        shares_embedding = semantic_shares_tagger()
        if shares_embedding:
            json_data["with_embedding"] = True
        try:
            response = sidecars.post(
                "tags", "/generate-tags", json=json_data, timeout=TAGS
            )
        except requests.HTTPError as error:
            # raise_for_status() always attaches the response it checked.
            assert error.response is not None
            logger.warning(
                "Tag service returned status %s for image %s: %s",
                error.response.status_code,
                image_path,
                sidecars.error_detail(error),
            )
            return

        try:
            response_json = response.json()
        except ValueError, RuntimeError:
            logger.warning(
                "Tag service returned non-JSON response for image %s", image_path
            )
            return

        tags_result = response_json.get("tags")

        if tags_result is None:
            return
        embedding = (
            tags_result.pop("embedding", None)
            if isinstance(tags_result, dict)
            else None
        )
        if shares_embedding and embedding:
            caption.store_search_embedding(embedding)

        caption.store_tags((tags_result or {}).get("tags", []), commit=commit)
        logger.info("generated %s tags for image %s.", OPENCLIP, image_path)
    except Exception as e:
        logger.exception(
            "could not generate tags for image %s",
            photo.main_file.path if photo.main_file else "no main file",
        )
        raise e
