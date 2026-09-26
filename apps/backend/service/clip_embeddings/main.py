import numpy as np
from clip_onnx import ClipEmbeddings

from service._common import create_app, json_fields, serve_forever

# The sessions load on the first request and go again on /unload-model.
clip = ClipEmbeddings()
app = create_app(
    "clip_embeddings", unload=clip.unload, is_loaded=lambda: clip.is_loaded
)


@app.route("/clip-embeddings", methods=["POST"])
def create_clip_embeddings():
    """Embeddings for a list of image paths.

    The response keeps one slot per requested path: an embedding and its
    magnitude, or ``null`` in both lists where the image could not be read,
    so the caller can match results to photos by position.
    """
    imgs, model = json_fields("imgs", "model")

    embeddings = clip.encode_images(imgs, model)
    imgs_emb = [None if e is None else e.tolist() for e in embeddings]
    magnitudes = [None if e is None else float(np.linalg.norm(e)) for e in embeddings]
    return {"imgs_emb": imgs_emb, "magnitudes": magnitudes}, 200


@app.route("/query-embeddings", methods=["POST"])
def calculate_query_embeddings():
    query, model = json_fields("query", "model")

    embedding = clip.encode_text(query, model)
    return {
        "emb": embedding.tolist(),
        "magnitude": float(np.linalg.norm(embedding)),
    }, 200


def serve():
    serve_forever(app, "clip_embeddings")


if __name__ == "__main__":
    serve()
