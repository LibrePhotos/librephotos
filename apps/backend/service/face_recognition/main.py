import time

import gevent
import numpy as np
from PIL import Image
from flask import Flask, request
from gevent.pywsgi import WSGIServer

app = Flask(__name__)

last_request_time = None
face_analysis_models = {}
DEFAULT_MODEL_NAME = "buffalo_sc"
FACE_MODEL_ROOT = "/protected_media/data_models/face_recognition"
SUPPORTED_FACE_MODELS = {
    "antelopev2",
    "buffalo_l",
    "buffalo_m",
    "buffalo_s",
    "buffalo_sc",
}


def log(message):
    print(f"face_recognition: {message}")


def _normalize_model_name(model_name):
    if model_name in SUPPORTED_FACE_MODELS:
        return model_name
    return DEFAULT_MODEL_NAME


def _get_face_analysis(model_name):
    model_name = _normalize_model_name(model_name)
    if model_name not in face_analysis_models:
        from insightface.app import FaceAnalysis

        face_analysis = FaceAnalysis(
            name=model_name,
            root=FACE_MODEL_ROOT,
            allowed_modules=["detection", "recognition"],
            providers=["CPUExecutionProvider"],
        )
        face_analysis.prepare(ctx_id=-1, det_size=(640, 640))
        face_analysis_models[model_name] = face_analysis
    return face_analysis_models[model_name]


def _to_face_location(bbox):
    left, top, right, bottom = bbox
    return (
        int(round(top)),
        int(round(right)),
        int(round(bottom)),
        int(round(left)),
    )


def _iou(face_location, detected_location):
    top = max(face_location[0], detected_location[0])
    right = min(face_location[1], detected_location[1])
    bottom = min(face_location[2], detected_location[2])
    left = max(face_location[3], detected_location[3])

    width = max(0, right - left)
    height = max(0, bottom - top)
    intersection = width * height

    if intersection == 0:
        return 0.0

    face_area = (face_location[1] - face_location[3]) * (
        face_location[2] - face_location[0]
    )
    detected_area = (detected_location[1] - detected_location[3]) * (
        detected_location[2] - detected_location[0]
    )
    union = face_area + detected_area - intersection
    if union <= 0:
        return 0.0
    return intersection / union


def _find_best_face_match(face_locations, detected_faces):
    matches = []
    remaining_indices = set(range(len(detected_faces)))

    for face_location in face_locations:
        best_index = None
        best_score = -1.0
        for detected_index in remaining_indices:
            score = _iou(face_location, _to_face_location(detected_faces[detected_index].bbox))
            if score > best_score:
                best_score = score
                best_index = detected_index

        if best_index is None:
            continue

        remaining_indices.discard(best_index)
        matches.append(detected_faces[best_index])

    return matches


@app.route("/face-encodings", methods=["POST"])
def create_face_encodings():
    global last_request_time
    # Update last request time
    last_request_time = time.time()

    try:
        data = request.get_json()
        source = data["source"]
        face_locations = data["face_locations"]
        model_name = data.get("model_name")
    except Exception:
        return "", 400

    try:
        image = np.array(Image.open(source))
        face_analysis = _get_face_analysis(model_name)
        detected_faces = face_analysis.get(image)
        matched_faces = _find_best_face_match(face_locations, detected_faces)
        face_encodings_list = [face.embedding.tolist() for face in matched_faces]
    except Exception as exc:
        log(f"error creating face_encodings for {source}: {exc}")
        return {"error": str(exc)}, 500

    log(f"created face_encodings={len(face_encodings_list)}")
    return {"encodings": face_encodings_list}, 201


@app.route("/face-locations", methods=["POST"])
def create_face_locations():
    global last_request_time
    # Update last request time
    last_request_time = time.time()

    try:
        data = request.get_json()
        source = data["source"]
        model_name = data.get("model_name")
    except Exception:
        return "", 400

    try:
        image = np.array(Image.open(source))
        face_analysis = _get_face_analysis(model_name)
        face_locations = [_to_face_location(face.bbox) for face in face_analysis.get(image)]
    except Exception as exc:
        log(f"error creating face_locations for {source}: {exc}")
        return {"error": str(exc)}, 500

    log(f"created face_location={face_locations}")
    return {"face_locations": face_locations}, 201


@app.route("/health", methods=["GET"])
def health():
    return {"last_request_time": last_request_time}, 200


if __name__ == "__main__":
    log("service starting")
    server = WSGIServer(("0.0.0.0", 8005), app)
    server_thread = gevent.spawn(server.serve_forever)
    gevent.joinall([server_thread])
