import time

import gevent
from flask import Flask, request
from gevent.pywsgi import WSGIServer

from florence2 import Florence2Captioner, model_dir_for

app = Flask(__name__)

DEFAULT_MODEL = "florence2_base_int8"
CAPTIONING_MODELS = ("florence2_base", "florence2_base_int8")

captioner = None
captioner_model = None
last_request_time = None


def log(message):
    print(f"image_captioning: {message}")


def get_captioner(model):
    """The loaded captioner for ``model``, swapping it out when the model changes."""
    global captioner, captioner_model
    if captioner is None or captioner_model != model:
        if captioner is not None:
            captioner.unload()
        captioner = Florence2Captioner(model_dir_for(model))
        captioner_model = model
    return captioner


@app.route("/generate-caption", methods=["POST"])
def generate_caption():
    global last_request_time
    last_request_time = time.time()

    try:
        data = request.get_json()
        image_path = data["image_path"]
        model = data.get("model") or DEFAULT_MODEL
    except Exception as e:
        print(str(e))
        return "", 400

    if model not in CAPTIONING_MODELS:
        return {"error": f"Unknown captioning model {model!r}"}, 400

    try:
        return {"caption": get_captioner(model).caption(image_path)}, 201
    except Exception as e:
        log(f"error captioning {image_path}: {e}")
        return {"error": "Failed to generate caption"}, 500


@app.route("/unload-model", methods=["GET"])
def unload_model():
    global captioner, captioner_model
    if captioner is not None:
        captioner.unload()
    captioner = None
    captioner_model = None
    return "", 200


@app.route("/health", methods=["GET"])
def health():
    return {"last_request_time": last_request_time}, 200


if __name__ == "__main__":
    log("service starting")
    server = WSGIServer(("0.0.0.0", 8007), app)
    server_thread = gevent.spawn(server.serve_forever)
    gevent.joinall([server_thread])
