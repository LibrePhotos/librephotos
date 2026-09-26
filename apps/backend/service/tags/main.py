import os
import time

import gevent
from flask import Flask, request
from gevent.pywsgi import WSGIServer
from mobileclip.mobileclip import MobileCLIP
from siglip2.siglip2 import SigLIP2

app = Flask(__name__)

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
last_request_time = None


def log(message):
    print(f"tags: {message}")


def parse_tag_request():
    data = request.get_json()
    return (
        data["image_path"],
        data.get("confidence", 0.4),
        data.get("tagging_model") or DEFAULT_TAGGING_MODEL,
    )


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
    global last_request_time
    last_request_time = time.time()

    try:
        image_path, _confidence, tagging_model = parse_tag_request()
    except Exception as e:
        print(str(e))
        return "", 400

    tagger = get_tagger(tagging_model)
    if tagger is None:
        return {"error": f"Unknown tagging model {tagging_model!r}"}, 400

    _, threshold = TAGGERS[tagging_model]
    try:
        return {
            "tags": tagger.predict(image_path, threshold=threshold, max_tags=MAX_TAGS)
        }, 201
    except Exception as e:
        # A tagger that failed half-way through loading must not be reused.
        tagger_instances.pop(tagging_model, None)
        print(f"tags: Error processing image {image_path}: {e}")
        return {"error": "Failed to process image"}, 500


@app.route("/health", methods=["GET"])
def health():
    return {"last_request_time": last_request_time}, 200


def serve():
    log("service starting")
    # Loopback: the backend calls the sidecars on 127.0.0.1 (api.sidecars), and
    # they have no authentication. SERVICE_HOST overrides it.
    server = WSGIServer((os.environ.get("SERVICE_HOST", "127.0.0.1"), 8011), app)
    server_thread = gevent.spawn(server.serve_forever)
    gevent.joinall([server_thread])


if __name__ == "__main__":
    serve()
