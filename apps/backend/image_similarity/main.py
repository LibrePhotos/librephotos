from retrieval_index import RetrievalIndex
from utils import logger

from service._common import create_app, json_fields, serve_forever

app = create_app("image_similarity")

index = RetrievalIndex()


@app.route("/build/", methods=["POST"])
def build_index():
    user_id, image_hashes, image_embeddings = json_fields(
        "user_id", "image_hashes", "image_embeddings"
    )

    index.build_index_for_user(user_id, image_hashes, image_embeddings)

    # Return 0 if no index was created, otherwise return the actual size
    index_size = index.indices[user_id].ntotal if user_id in index.indices else 0
    return {"status": True, "index_size": index_size}


@app.route("/build/", methods=["DELETE"])
def delete_index():
    (user_id,) = json_fields("user_id")
    if user_id not in index.indices:
        return {"status": True}
    del index.indices[user_id]
    del index.image_hashes[user_id]
    return {"status": True}


@app.route("/search/", methods=["POST"])
def search_index():
    try:
        user_id, image_embedding, n, threshold = json_fields(
            "user_id", "image_embedding", n=100, threshold=27.0
        )
        res = index.search_similar(user_id, image_embedding, int(n), float(threshold))
        return {"status": True, "result": res}
    except BaseException as e:
        logger.error(str(e))
        return {"status": False, "result": []}, 500


def serve():
    serve_forever(app, "image_similarity")


if __name__ == "__main__":
    serve()
