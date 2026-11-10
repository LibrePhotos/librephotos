import logging
from collections.abc import Iterator, Sequence
from datetime import datetime
from math import ceil
from typing import TYPE_CHECKING, Any, TypedDict
from uuid import UUID

import requests
from django.db.models import QuerySet

from api.lazy_import import LazyModule
from api.models import Photo, User
from api.runtime import sidecars
from api.runtime.http_timeouts import SIMILARITY
from api.search.semantic import (
    SEARCH_THRESHOLD,
    SIMILAR_THRESHOLD,
    is_current_embedding,
    produced_by_openclip,
)

if TYPE_CHECKING:
    import numpy as np
else:
    np = LazyModule("numpy")

logger = logging.getLogger(__name__)


class SimilarPhotosReply(TypedDict):
    """The sidecar's JSON answer to a successful /search/: hashes in result."""

    status: bool
    result: list[str]


# Embeddings per request of an index rebuild.
INDEX_PAGE_SIZE = 5000


def search_similar_embedding(
    user: User | int,
    emb: Sequence[float],
    result_count: int = 100,
    threshold: float | None = None,
) -> list[str]:
    """Hashes of the user's photos closest to ``emb``, a query embedding;
    ``threshold`` defaults to the search cut."""
    if threshold is None:
        threshold = SEARCH_THRESHOLD
    if isinstance(user, int):
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
    try:
        res = sidecars.post(
            "image_similarity", "/search/", json=post_data, timeout=SIMILARITY
        )
    # Not only an error reply: a stopped, restarting or busy sidecar raises a
    # ConnectionError or a timeout, which used to fail the whole search.
    except requests.RequestException as error:
        logger.error(
            "error retrieving similar embeddings for user %s: %s",
            user_id,
            sidecars.error_detail(error),
        )
        return []
    return res.json()["result"]


def search_similar_image(
    user: User | int, photo: Photo, threshold: float | None = None
) -> SimilarPhotosReply | list[str]:
    """The user's photos similar to ``photo``.

    A photo whose embedding comes from an earlier model (not converted yet)
    has none: its vector cannot be compared with the index.
    """
    if isinstance(user, int):
        user_id = user
    else:
        user_id = user.id

    clip_embeddings = photo.get_clip_embeddings()
    if clip_embeddings is None:
        return []
    if not is_current_embedding(photo):
        return []
    if threshold is None:
        threshold = SIMILAR_THRESHOLD

    image_embedding = np.array(clip_embeddings, dtype=np.float32)

    post_data = {
        "user_id": user_id,
        "image_embedding": image_embedding.tolist(),
        "threshold": threshold,
    }
    try:
        res = sidecars.post(
            "image_similarity", "/search/", json=post_data, timeout=SIMILARITY
        )
    # As above: an unreachable sidecar must not fail the photo detail request.
    except requests.RequestException as error:
        logger.error(
            "error retrieving similar photos to %s belonging to user %s: %s",
            photo.image_hash,
            user_id,
            sidecars.error_detail(error),
        )
        return []
    return res.json()


class SimilarityIndexError(RuntimeError):
    """The similarity sidecar did not take a page of the index rebuild."""


class SimilarityRebuildSupersededError(SimilarityIndexError):
    """A newer rebuild of the same index took over from this one."""


class _BuildPage(TypedDict):
    image_hashes: list[str]
    image_embeddings: list[list[float]]


def build_image_similarity_index(user: User) -> int:
    """Rebuild the user's similarity index from their CLIP embeddings.

    Only OpenCLIP's embeddings go in (api.search.semantic): while a library
    is being converted from an earlier model, the photos not converted yet are
    left out rather than mixed in.

    The pages go to the sidecar as one rebuild: the first carries ``begin``
    and its answer a ``rebuild_token`` the later pages send back, the last
    carries ``commit``, and the sidecar swaps the new index in only after the
    last one, so searches keep answering from the old index meanwhile and a
    failed rebuild leaves it in place. A rebuild superseded by a newer one
    (the embedding job and the upload follow-ups both rebuild) stops there
    and returns 0: the newer one reads the same photos later. Raises
    SimilarityIndexError when the sidecar refuses or misses a page.
    """
    logger.info("building similarity index for user %s", user.id)
    start = datetime.now()
    try:
        index_size = _send_rebuild(user)
    except SimilarityRebuildSupersededError as superseded:
        logger.info("%s; the newer rebuild carries on", superseded)
        return 0
    elapsed = (datetime.now() - start).total_seconds()
    logger.info(
        "building similarity index of %d photos took %.2f seconds", index_size, elapsed
    )
    return index_size


def _send_rebuild(user: User) -> int:
    photos = _indexed_photos(user)
    # An empty queryset still has one (empty) page, so a user without
    # embeddings gets an empty index rather than keeping a stale one.
    last_page = max(1, ceil(photos.count() / INDEX_PAGE_SIZE))
    token: str | None = None
    index_size = 0
    for number, page in enumerate(_build_pages(photos, last_page), start=1):
        final = number == last_page
        post_data: dict[str, object] = {
            "user_id": user.id,
            **page,
            "begin": token is None,
            "commit": final,
        }
        if token is not None:
            post_data["rebuild_token"] = token
        where = (
            f"page {number} of {last_page} of the similarity index of user {user.id}"
        )
        body = _post_build_page(where, post_data)
        index_size = body.get("index_size", 0)
        token = body.get("rebuild_token")
        if token is None and not final:
            raise SimilarityIndexError(f"{where} was answered without a rebuild_token")
    return index_size


def _indexed_photos(user: User) -> QuerySet[Photo]:
    # isnull rather than exclude(clip_embeddings=None): that compares every
    # stored embedding with JSON null, reading each one out of TOAST just to
    # count them. A JSON null left in is skipped below, as an empty one is.
    return (
        Photo.objects.owned_by(user)
        .filter(hidden=False, clip_embeddings__isnull=False)
        .filter(produced_by_openclip())
    )


def _build_pages(photos: QuerySet[Photo], last_page: int) -> Iterator[_BuildPage]:
    # Keyset pages on (owner, id), not OFFSET ones: each OFFSET page sorted
    # all of the user's photos again, a parallel full scan per page, three
    # rebuilds per conversion run on a large library (#2868).
    after: UUID | None = None
    for _ in range(last_page):
        page_photos = photos.only("clip_embeddings", "image_hash").order_by("pk")
        if after is not None:
            page_photos = page_photos.filter(pk__gt=after)
        page = _BuildPage(image_hashes=[], image_embeddings=[])
        for photo in page_photos[:INDEX_PAGE_SIZE]:
            after = photo.pk
            clip_embeddings = photo.get_clip_embeddings()
            if clip_embeddings is not None:
                page["image_hashes"].append(photo.image_hash)
                image_embedding = np.array(clip_embeddings, dtype=np.float32)
                page["image_embeddings"].append(image_embedding.tolist())
        yield page


def _post_build_page(where: str, post_data: dict[str, object]) -> dict[str, Any]:
    try:
        body = sidecars.post(
            "image_similarity", "/build/", json=post_data, timeout=SIMILARITY
        ).json()
    except (requests.RequestException, ValueError) as error:
        message = f"{where} failed: {sidecars.error_detail(error)}"
        if _error_code(error) == "rebuild_superseded":
            raise SimilarityRebuildSupersededError(message) from error
        raise SimilarityIndexError(message) from error
    if not isinstance(body, dict) or body.get("status") is not True:
        raise SimilarityIndexError(f"{where} was refused: {body!r}")
    return body


def _error_code(error: Exception) -> object:
    response = getattr(error, "response", None)
    if response is None:
        return None
    try:
        body = response.json()
    except ValueError:
        return None
    return body.get("code") if isinstance(body, dict) else None
