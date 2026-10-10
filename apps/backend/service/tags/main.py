"""Tags, search embeddings and query embeddings: OpenCLIP ViT-B/32.

LibrePhotos runs one image-text model, so one sidecar serves all of it: the
image tower tags a photo and gives its semantic-search embedding in the same
run (``/generate-tags`` with ``with_embedding``), re-embeds photos in batches
(``/clip-embeddings``, optionally with their tags) and the text tower turns a
search query into an embedding (``/query-embeddings``).
"""

import os

import numpy as np
from openclip.openclip import (
    DEFAULT_MAX_TAGS,
    DEFAULT_MIN_PROBABILITY,
    MODEL_NAME,
    OpenCLIP,
)

from service._common import create_app, json_fields, logger, serve_forever

MAX_TAGS = DEFAULT_MAX_TAGS
MIN_PROBABILITY = DEFAULT_MIN_PROBABILITY

tagger_instances = {}
log = logger("tags")


def unload_tagger():
    tagger_instances.clear()


app = create_app("tags", unload=unload_tagger, is_loaded=lambda: bool(tagger_instances))


def parse_tag_request():
    image_path, _confidence, tagging_model, with_embedding = json_fields(
        "image_path", confidence=0.4, tagging_model=None, with_embedding=False
    )
    return image_path, tagging_model or MODEL_NAME, bool(with_embedding)


def image_exists(image_path):
    return isinstance(image_path, str) and os.path.isfile(image_path)


def get_tagger():
    """The model, built on first use and kept until /unload-model."""
    if MODEL_NAME not in tagger_instances:
        tagger_instances[MODEL_NAME] = OpenCLIP()
    return tagger_instances[MODEL_NAME]


@app.route("/generate-tags", methods=["POST"])
def generate_tags():
    image_path, tagging_model, with_embedding = parse_tag_request()

    if tagging_model != MODEL_NAME:
        return {"error": f"Unknown tagging model {tagging_model!r}"}, 400

    # A missing file is bad input, not a broken model: answered before the
    # handler below, which drops the model and makes the next photo reload
    # it after any failure.
    if not image_exists(image_path):
        log(f"image not found: {image_path}")
        return {"error": "Image not found"}, 400

    tagger = get_tagger()
    try:
        return {
            "tags": tagger.predict(
                image_path,
                threshold=MIN_PROBABILITY,
                max_tags=MAX_TAGS,
                with_embedding=with_embedding,
            )
        }, 200
    except Exception as e:
        # A model that failed half-way through loading must not be reused.
        tagger_instances.pop(MODEL_NAME, None)
        log(f"Error processing image {image_path}: {e}")
        return {"error": "Failed to process image"}, 500


@app.route("/clip-embeddings", methods=["POST"])
def image_embeddings():
    """``{"imgs": [paths], "with_tags": bool}`` -> ``{"imgs_emb", "magnitudes"}``
    (and ``"tags"``), raw, one slot per path and ``null`` where the image
    cannot be read. The tags come from the same image-tower run."""
    imgs, with_tags = json_fields("imgs", with_tags=False)
    tagger = get_tagger()
    embeddings = tagger.embed_images_raw(imgs)
    body = {
        "imgs_emb": [None if e is None else e.tolist() for e in embeddings],
        "magnitudes": [
            None if e is None else float(np.linalg.norm(e)) for e in embeddings
        ],
    }
    if with_tags:
        body["tags"] = [
            None
            if e is None
            else tagger.tags_for(e, threshold=MIN_PROBABILITY, max_tags=MAX_TAGS)
            for e in embeddings
        ]
    return body, 200


@app.route("/query-embeddings", methods=["POST"])
def query_embeddings():
    """``{"query"}`` -> ``{"emb", "magnitude"}``, the raw text embedding."""
    (query,) = json_fields("query")
    embedding = get_tagger().embed_text_raw(str(query))
    return {"emb": embedding.tolist(), "magnitude": float(np.linalg.norm(embedding))}


def serve():
    serve_forever(app, "tags")


if __name__ == "__main__":
    serve()
