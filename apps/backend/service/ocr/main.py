"""OCR sidecar: Flask + gevent WSGIServer on port 8012.

Mirrors service/tags/main.py: a lazily-created singleton engine, ``last_request_time``
stamped at the START of each request (the supervisor restarts services idle for
more than 120s, and a legitimate multi-second OCR run must not be mistaken for
idle), and a /health endpoint of the same shape.

Importing this module never starts the server or loads the model, so the engine
is fully testable via ppocr.* without touching Flask/gevent.
"""

import os
import time

import gevent
from flask import Flask, request
from gevent.pywsgi import WSGIServer
from ppocr.detect import OCRDecodeError
from ppocr.engine import PPOCREngine

app = Flask(__name__)

ocr_engine = None
last_request_time = None

DEFAULT_MIN_CONFIDENCE = 0.6


def log(message):
    print(f"ocr: {message}")


def _get_engine():
    global ocr_engine
    if ocr_engine is None:
        ocr_engine = PPOCREngine()
    return ocr_engine


@app.route("/ocr", methods=["POST"])
def ocr():
    # Stamp at request START so a long (e.g. 90s) run never looks idle to the
    # supervisor's >120s health check.
    global last_request_time
    last_request_time = time.time()

    try:
        data = request.get_json()
        image_path = data["image_path"]
        min_confidence = float(data.get("min_confidence", DEFAULT_MIN_CONFIDENCE))
        max_side = data.get("max_side")
        if max_side is not None:
            max_side = int(max_side)
        det_only = bool(data.get("det_only", False))
    except Exception as e:
        print(str(e))
        return "", 400

    # Validate the input path BEFORE touching the engine: a missing/unreadable
    # file is bad input (400), and checking here means we never pay the model
    # load just to reject it.
    if not isinstance(image_path, str) or not os.path.isfile(image_path):
        print(f"ocr: image not found: {image_path}")
        return {"error": "Image not found"}, 400

    try:
        engine = _get_engine()
        result = engine.predict(
            image_path,
            min_confidence=min_confidence,
            max_side=max_side,
            det_only=det_only,
        )
        return result, 201
    except OCRDecodeError as e:
        # Bad/undecodable input image -> client error, mirroring how the other
        # services treat unusable input.
        print(f"ocr: could not decode image {image_path}: {e}")
        return {"error": "Failed to decode image"}, 400
    except Exception as e:
        print(f"ocr: Error processing image {image_path}: {e}")
        return {"error": "Failed to process image"}, 500


@app.route("/health", methods=["GET"])
def health():
    return {"last_request_time": last_request_time}, 200


if __name__ == "__main__":
    log("service starting")
    server = WSGIServer(("0.0.0.0", 8012), app)
    server_thread = gevent.spawn(server.serve_forever)
    gevent.joinall([server_thread])
