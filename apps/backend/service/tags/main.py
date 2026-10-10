import os

import numpy as np
from mobileclip.mobileclip import MobileCLIP
from siglip2.siglip2 import SigLIP2

from service._common import create_app, json_fields, logger, serve_forever

DEFAULT_TAGGING_MODEL = "mobileclip_s2"
# Semantic search on MobileCLIP-S2 (site setting SEMANTIC_SEARCH_MODEL) runs
# here rather than in the clip_embeddings sidecar: this process holds the
# image tower for tagging anyway, so a library tagged and searched with it
# never loads a second vision model. Same contract as clip_embeddings.
SEARCH_MODEL = "mobileclip_s2"
MAX_TAGS = 10

# Per-model minimum score for a tag to be kept. The two scales differ on
# purpose: SigLIP 2 is cut on raw cosine similarity, MobileCLIP on the
# softmax probability over all tags (see mobileclip.py for why).
TAGGERS = {
    "siglip2": (SigLIP2, 0.05),
    "mobileclip_s2": (MobileCLIP, 0.02),
}

tagger_instances = {}
log = logger("tags")


def unload_taggers():
    tagger_instances.clear()


app = create_app(
    "tags", unload=unload_taggers, is_loaded=lambda: bool(tagger_instances)
)


def parse_tag_request():
    image_path, confidence, tagging_model, with_embedding = json_fields(
        "image_path", confidence=0.4, tagging_model=None, with_embedding=False
    )
    return (
        image_path,
        confidence,
        tagging_model or DEFAULT_TAGGING_MODEL,
        bool(with_embedding),
    )


def image_exists(image_path):
    return isinstance(image_path, str) and os.path.isfile(image_path)


def get_tagger(tagging_model):
    """The cached tagger for a model, built on first use; None for an unknown model."""
    if tagging_model not in TAGGERS:
        return None
    if tagging_model not in tagger_instances:
        tagger_cls, _ = TAGGERS[tagging_model]
        tagger_instances[tagging_model] = tagger_cls()
    return tagger_instances[tagging_model]


@app.route("/generate-tags", methods=["POST"])
def generate_tags():
    image_path, _confidence, tagging_model, with_embedding = parse_tag_request()

    tagger = get_tagger(tagging_model)
    if tagger is None:
        return {"error": f"Unknown tagging model {tagging_model!r}"}, 400

    # A missing file is bad input, not a broken model: answered before the
    # handler below, which drops the model and makes the next photo reload
    # it (~0.4 s) after any failure.
    if not image_exists(image_path):
        log(f"image not found: {image_path}")
        return {"error": "Image not found"}, 400

    _, threshold = TAGGERS[tagging_model]
    # The image embedding for semantic search, from the same run: only
    # MobileCLIP-S2 is a search model (see the routes below).
    options = (
        {"with_embedding": True}
        if with_embedding and tagging_model == SEARCH_MODEL
        else {}
    )
    try:
        return {
            "tags": tagger.predict(
                image_path, threshold=threshold, max_tags=MAX_TAGS, **options
            )
        }, 200
    except Exception as e:
        # A tagger that failed half-way through loading must not be reused.
        tagger_instances.pop(tagging_model, None)
        log(f"Error processing image {image_path}: {e}")
        return {"error": "Failed to process image"}, 500


@app.route("/clip-embeddings", methods=["POST"])
def image_embeddings():
    """``{"imgs": [paths]}`` -> ``{"imgs_emb", "magnitudes"}``, raw, one slot per
    path and ``null`` where the image cannot be read."""
    (imgs,) = json_fields("imgs")
    tagger = get_tagger(SEARCH_MODEL)
    embeddings = []
    for path in imgs:
        try:
            embeddings.append(tagger.embed_image_raw(path)[0])
        except (OSError, ValueError) as error:
            # PIL.UnidentifiedImageError is an OSError; so is a missing file.
            log(f"skipping unreadable image {path}: {error}")
            embeddings.append(None)
    return {
        "imgs_emb": [None if e is None else e.tolist() for e in embeddings],
        "magnitudes": [
            None if e is None else float(np.linalg.norm(e)) for e in embeddings
        ],
    }, 200


@app.route("/query-embeddings", methods=["POST"])
def query_embeddings():
    """``{"query"}`` -> ``{"emb", "magnitude"}``, the raw text embedding."""
    (query,) = json_fields("query")
    embedding = get_tagger(SEARCH_MODEL).embed_text_raw(str(query))
    return {"emb": embedding.tolist(), "magnitude": float(np.linalg.norm(embedding))}


def serve():
    serve_forever(app, "tags")


if __name__ == "__main__":
    serve()
