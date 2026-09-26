from mobileclip.mobileclip import MobileCLIP
from siglip2.siglip2 import SigLIP2

from service._common import create_app, json_fields, logger, serve_forever

DEFAULT_TAGGING_MODEL = "mobileclip_s2"
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
    image_path, confidence, tagging_model = json_fields(
        "image_path", confidence=0.4, tagging_model=None
    )
    return image_path, confidence, tagging_model or DEFAULT_TAGGING_MODEL


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
    image_path, _confidence, tagging_model = parse_tag_request()

    tagger = get_tagger(tagging_model)
    if tagger is None:
        return {"error": f"Unknown tagging model {tagging_model!r}"}, 400

    _, threshold = TAGGERS[tagging_model]
    try:
        return {
            "tags": tagger.predict(image_path, threshold=threshold, max_tags=MAX_TAGS)
        }, 200
    except Exception as e:
        # A tagger that failed half-way through loading must not be reused.
        tagger_instances.pop(tagging_model, None)
        log(f"Error processing image {image_path}: {e}")
        return {"error": "Failed to process image"}, 500


def serve():
    serve_forever(app, "tags")


if __name__ == "__main__":
    serve()
