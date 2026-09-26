"""OCR sidecar: a lazily-created singleton engine behind the shared sidecar app
(service._common), which stamps the idle clock at the start of each request and
unloads the engine when the watchdog finds the sidecar idle.

Importing this module never starts the server or loads the model, so the engine
is fully testable via ppocr.* without touching Flask/gevent.
"""

import os

from ppocr.detect import OCRDecodeError
from ppocr.engine import PPOCREngine

from service._common import create_app, json_fields, logger, serve_forever

ocr_engine = None

DEFAULT_MIN_CONFIDENCE = 0.6

log = logger("ocr")


def _unload_engine():
    global ocr_engine
    ocr_engine = None


app = create_app("ocr", unload=_unload_engine, is_loaded=lambda: ocr_engine is not None)


def _get_engine():
    global ocr_engine
    if ocr_engine is None:
        ocr_engine = PPOCREngine()
    return ocr_engine


@app.route("/ocr", methods=["POST"])
def ocr():
    image_path, min_confidence, max_side, det_only = json_fields(
        "image_path",
        min_confidence=DEFAULT_MIN_CONFIDENCE,
        max_side=None,
        det_only=False,
    )
    try:
        min_confidence = float(min_confidence)
        if max_side is not None:
            max_side = int(max_side)
        det_only = bool(det_only)
    except (TypeError, ValueError) as e:
        log(str(e))
        return "", 400

    # Validate the input path BEFORE touching the engine: a missing/unreadable
    # file is bad input (400), and checking here means we never pay the model
    # load just to reject it.
    if not isinstance(image_path, str) or not os.path.isfile(image_path):
        log(f"image not found: {image_path}")
        return {"error": "Image not found"}, 400

    try:
        engine = _get_engine()
        result = engine.predict(
            image_path,
            min_confidence=min_confidence,
            max_side=max_side,
            det_only=det_only,
        )
        return result, 200
    except OCRDecodeError as e:
        # Bad/undecodable input image -> client error, mirroring how the other
        # services treat unusable input.
        log(f"could not decode image {image_path}: {e}")
        return {"error": "Failed to decode image"}, 400
    except Exception as e:
        log(f"Error processing image {image_path}: {e}")
        return {"error": "Failed to process image"}, 500


def serve():
    serve_forever(app, "ocr")


if __name__ == "__main__":
    serve()
