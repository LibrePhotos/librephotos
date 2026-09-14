import time

import gevent
from flask import Flask, request
from gevent.pywsgi import WSGIServer

from lfm2_vl import Lfm2VlCaptioner

app = Flask(__name__)

captioner = None
last_request_time = None


def log(message):
    print(f"image_captioning: {message}")


def get_captioner():
    global captioner
    if captioner is None:
        captioner = Lfm2VlCaptioner()
    return captioner


@app.route("/generate-caption", methods=["POST"])
def generate_caption():
    """A caption for ``image_path``, steered by the optional ``prompt``."""
    global last_request_time
    last_request_time = time.time()

    try:
        data = request.get_json()
        image_path = data["image_path"]
        prompt = data.get("prompt")
    except Exception as e:
        print(str(e))
        return "", 400

    try:
        return {"caption": get_captioner().caption(image_path, prompt)}, 201
    except Exception as e:
        # A captioner that failed half-way through loading must not be reused.
        global captioner
        captioner = None
        log(f"error captioning {image_path}: {e}")
        return {"error": "Failed to generate caption"}, 500


@app.route("/unload-model", methods=["GET"])
def unload_model():
    global captioner
    if captioner is not None:
        captioner.unload()
    captioner = None
    return "", 200


@app.route("/health", methods=["GET"])
def health():
    return {"last_request_time": last_request_time}, 200


if __name__ == "__main__":
    log("service starting")
    server = WSGIServer(("0.0.0.0", 8007), app)
    server_thread = gevent.spawn(server.serve_forever)
    gevent.joinall([server_thread])
