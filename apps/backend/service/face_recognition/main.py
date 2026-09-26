import os
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
# How much a requested region (drawn by hand, or read from XMP) must overlap a
# detected face to take its embedding. A drawn box is looser than the
# detector's, so this is well below 1; a neighbour's face shares far less.
MIN_FACE_MATCH_IOU = 0.3
# The sidecars never load Django, so the data root comes in as BASE_DATA (see
# api.services._service_environment). Unset, this is the Docker layout under /.
FACE_MODEL_ROOT = os.path.join(
    os.environ.get("BASE_DATA", os.sep),
    "protected_media",
    "data_models",
    "face_recognition",
)
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
    """The detected face at each requested location, None where there is none.

    One entry per location, in order. A location no detected face overlaps by
    MIN_FACE_MATCH_IOU is left unmatched rather than handed whichever face is
    left: its embedding would file the region under somebody else.
    """
    matches = []
    remaining_indices = set(range(len(detected_faces)))

    for face_location in face_locations:
        best_index = None
        best_score = MIN_FACE_MATCH_IOU
        for detected_index in remaining_indices:
            score = _iou(
                face_location, _to_face_location(detected_faces[detected_index].bbox)
            )
            if score >= best_score:
                best_score = score
                best_index = detected_index

        if best_index is None:
            matches.append(None)
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
        image = np.array(Image.open(source).convert("RGB"))
        face_analysis = _get_face_analysis(model_name)
        detected_faces = face_analysis.get(image)
        matched_faces = _find_best_face_match(face_locations, detected_faces)
        face_encodings_list = [
            None if face is None else face.embedding.tolist() for face in matched_faces
        ]
    except Exception as exc:
        log(f"error creating face_encodings for {source}: {exc}")
        return {"error": str(exc)}, 500

    matched = sum(encoding is not None for encoding in face_encodings_list)
    log(f"created face_encodings={matched}/{len(face_encodings_list)}")
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
        image = np.array(Image.open(source).convert("RGB"))
        face_analysis = _get_face_analysis(model_name)
        faces = face_analysis.get(image)
        face_locations = [_to_face_location(face.bbox) for face in faces]
        # get() has already run recognition on every face it found. Handing
        # the embeddings back saves a /face-encodings call per face, each of
        # which ran detection and recognition over the whole picture again.
        face_encodings = [face.embedding.tolist() for face in faces]
    except Exception as exc:
        log(f"error creating face_locations for {source}: {exc}")
        return {"error": str(exc)}, 500

    log(f"created face_location={face_locations}")
    return {"face_locations": face_locations, "encodings": face_encodings}, 201


@app.route("/health", methods=["GET"])
def health():
    return {"last_request_time": last_request_time}, 200


def serve():
    log("service starting")
    # 0.0.0.0 inside the containers, as always; the standalone build sets
    # SERVICE_HOST to loopback (librephotos.standalone.prepare_environment).
    server = WSGIServer((os.environ.get("SERVICE_HOST", "0.0.0.0"), 8005), app)
    server_thread = gevent.spawn(server.serve_forever)
    gevent.joinall([server_thread])


if __name__ == "__main__":
    serve()
