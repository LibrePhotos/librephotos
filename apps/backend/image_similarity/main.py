"""Image similarity sidecar: per-user FAISS indices over the CLIP embeddings.

The indices are kept under BASE_DATA/protected_media/similarity (see
retrieval_index.RetrievalIndex), so a restart of this process no longer
forgets them until the next Calculate CLIP embeddings job.

``POST /build/``
    ``{"user_id", "image_hashes", "image_embeddings"}`` plus, for a rebuild,
    ``"begin": true`` on the first page, whose answer carries a
    ``"rebuild_token"`` that every later page sends back, and ``"commit":
    true`` on the last: the pages fill a staging index that replaces the
    user's index (on disk, then in memory) only once the last page arrived.
    A newer begin for the same user supersedes the open rebuild, and one
    without a page for ten minutes expires; a page of either is answered 409
    with ``"code": "rebuild_superseded"`` or ``"rebuild_not_open"``. A page
    without a token is added to the live index (and to the open rebuild, so
    its commit keeps it). Answers ``{"status": true, "index_size": n}``, or
    ``{"status": false, "error": ...}`` with 400.
``DELETE /build/``
    ``{"user_id"}``: forget the user's index, on disk too.
``POST /search/``
    ``{"user_id", "image_embedding", "n"?, "threshold"?}``: ``{"status": true,
    "result": [image hashes]}``; empty for a user without an index.
"""

import os

from flask.typing import ResponseReturnValue
from retrieval_index import IndexBuildError, RebuildNotOpenError, RetrievalIndex

from librephotos.env import protected_media_root
from service._common import create_app, json_fields, logger, serve_forever

INDEX_ROOT = os.path.join(protected_media_root(), "similarity")

log = logger("image_similarity")

app = create_app("image_similarity")
index = RetrievalIndex(store_dir=INDEX_ROOT)


def _user_id(value: object) -> int:
    # The id names a file under INDEX_ROOT, so nothing but an integer will do.
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"user_id must be an integer, not {value!r}")
    return value


def _failed(
    message: str, status: int = 400, code: str | None = None
) -> tuple[dict[str, object], int]:
    log.error(message)
    body: dict[str, object] = {"status": False, "error": message}
    if code is not None:
        body["code"] = code
    return body, status


@app.route("/build/", methods=["POST"])
def build_index() -> ResponseReturnValue:
    user_id, image_hashes, image_embeddings, begin, commit, token = json_fields(
        "user_id",
        "image_hashes",
        "image_embeddings",
        begin=False,
        commit=False,
        rebuild_token=None,
    )
    try:
        user_id = _user_id(user_id)
    except ValueError as e:
        return _failed(str(e))

    if begin:
        token = index.begin_rebuild(user_id)
    elif token is None:
        if commit:
            return _failed("a commit needs the rebuild_token of its begin")
        index.build_index_for_user(user_id, image_hashes, image_embeddings)
        live = index.indices.get(user_id)
        return {"status": True, "index_size": 0 if live is None else live.ntotal}
    elif not isinstance(token, str):
        return _failed(f"rebuild_token must be a string, not {token!r}")
    return _rebuild_page(user_id, token, image_hashes, image_embeddings, commit)


def _rebuild_page(
    user_id: int,
    token: str,
    image_hashes: list[str],
    image_embeddings: list[list[float]],
    commit: bool,
) -> ResponseReturnValue:
    try:
        index.add_to_rebuild(user_id, token, image_hashes, image_embeddings)
        if commit:
            size = index.commit_rebuild(user_id, token)
        else:
            size = index.staged_size(user_id, token)
    except RebuildNotOpenError as e:
        code = "rebuild_superseded" if e.superseded else "rebuild_not_open"
        return _failed(str(e), 409, code)
    except IndexBuildError as e:
        # A rebuild missing a page must not replace the index.
        index.abandon_rebuild(user_id, token)
        return _failed(f"rebuild for user {user_id} abandoned: {e}")
    return {"status": True, "index_size": size, "rebuild_token": token}


@app.route("/build/", methods=["DELETE"])
def delete_index() -> ResponseReturnValue:
    (user_id,) = json_fields("user_id")
    try:
        index.remove_user(_user_id(user_id))
    except ValueError as e:
        return _failed(str(e))
    return {"status": True}


@app.route("/search/", methods=["POST"])
def search_index() -> ResponseReturnValue:
    user_id, image_embedding, n, threshold = json_fields(
        "user_id", "image_embedding", n=100, threshold=27.0
    )
    try:
        user_id = _user_id(user_id)
        n = int(n)
        threshold = float(threshold)
    except (TypeError, ValueError) as e:
        return _failed(str(e))
    try:
        result = index.search_similar(user_id, image_embedding, n, threshold)
    except Exception as e:
        log.error("search for user %s failed: %s", user_id, e)
        return {"status": False, "result": [], "error": str(e)}, 500
    return {"status": True, "result": result}


def serve() -> None:
    serve_forever(app, "image_similarity")


if __name__ == "__main__":
    serve()
