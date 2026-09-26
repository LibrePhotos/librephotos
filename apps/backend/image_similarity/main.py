"""Image similarity sidecar: per-user FAISS indices over the CLIP embeddings.

The indices are kept under BASE_DATA/protected_media/similarity (see
retrieval_index.RetrievalIndex), so a restart of this process no longer
forgets them until the next Calculate CLIP embeddings job.

``POST /build/``
    ``{"user_id", "image_hashes", "image_embeddings"}`` plus, for a rebuild,
    ``"begin": true`` on the first page and ``"commit": true`` on the last:
    the pages fill a staging index that replaces the user's index (on disk,
    then in memory) only once the last page arrived. Without the flags a page
    is added to the live index, as before. Answers ``{"status": true,
    "index_size": n}``, or ``{"status": false, "error": ...}`` with 400.
``DELETE /build/``
    ``{"user_id"}``: forget the user's index, on disk too.
``POST /search/``
    ``{"user_id", "image_embedding", "n"?, "threshold"?}``: ``{"status": true,
    "result": [image hashes]}``; empty for a user without an index.
"""

import os

from retrieval_index import IndexBuildError, RetrievalIndex
from utils import logger

from service._common import create_app, json_fields, serve_forever

# The sidecars never load Django, so the data root comes in as BASE_DATA (see
# api.services._service_environment). Unset, this is the Docker layout under /.
INDEX_ROOT = os.path.join(
    os.environ.get("BASE_DATA", os.sep), "protected_media", "similarity"
)

app = create_app("image_similarity")
index = RetrievalIndex(store_dir=INDEX_ROOT)


def _user_id(value):
    # The id names a file under INDEX_ROOT, so nothing but an integer will do.
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError(f"user_id must be an integer, not {value!r}")
    return value


def _failed(message, status=400):
    logger.error(message)
    return {"status": False, "error": message}, status


@app.route("/build/", methods=["POST"])
def build_index():
    user_id, image_hashes, image_embeddings, begin, commit = json_fields(
        "user_id", "image_hashes", "image_embeddings", begin=False, commit=False
    )
    try:
        user_id = _user_id(user_id)
    except ValueError as e:
        return _failed(str(e))

    if not (begin or commit or index.rebuilding(user_id)):
        index.build_index_for_user(user_id, image_hashes, image_embeddings)
        live = index.indices.get(user_id)
        return {"status": True, "index_size": 0 if live is None else live.ntotal}

    try:
        if begin:
            index.begin_rebuild(user_id)
        index.add_to_rebuild(user_id, image_hashes, image_embeddings)
        if not commit:
            return {"status": True, "index_size": index.staged_size(user_id)}
        return {"status": True, "index_size": index.commit_rebuild(user_id)}
    except IndexBuildError as e:
        # A rebuild missing a page must not replace the index.
        index.abandon_rebuild(user_id)
        return _failed(f"rebuild for user {user_id} abandoned: {e}")


@app.route("/build/", methods=["DELETE"])
def delete_index():
    (user_id,) = json_fields("user_id")
    try:
        index.remove_user(_user_id(user_id))
    except ValueError as e:
        return _failed(str(e))
    return {"status": True}


@app.route("/search/", methods=["POST"])
def search_index():
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
        logger.error(f"search for user {user_id} failed: {e}")
        return {"status": False, "result": [], "error": str(e)}, 500
    return {"status": True, "result": result}


def serve():
    serve_forever(app, "image_similarity")


if __name__ == "__main__":
    serve()
