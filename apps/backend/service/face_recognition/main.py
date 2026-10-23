from __future__ import annotations

import os

import numpy as np
import numpy.typing as npt
from flask.typing import ResponseReturnValue
from PIL import Image, UnidentifiedImageError

from librephotos.env import data_models_root
from service._common import create_app, json_fields, logger, serve_forever
from service.face_recognition.face_analysis import Face, FaceAnalysis

face_analysis_models: dict[str, FaceAnalysis] = {}
DEFAULT_MODEL_NAME = "buffalo_sc"
# How much a requested region (drawn by hand, or read from XMP) must overlap a
# detected face to take its embedding. A drawn box is looser than the
# detector's, so this is well below 1; a neighbour's face shares far less.
MIN_FACE_MATCH_IOU = 0.3
FACE_MODEL_ROOT = os.path.join(data_models_root(), "face_recognition")
SUPPORTED_FACE_MODELS = {
    "antelopev2",
    "buffalo_l",
    "buffalo_m",
    "buffalo_s",
    "buffalo_sc",
}

log = logger("face_recognition")
app = create_app(
    "face_recognition",
    unload=face_analysis_models.clear,
    is_loaded=lambda: bool(face_analysis_models),
)


def _normalize_model_name(model_name: str | None) -> str:
    if model_name is not None and model_name in SUPPORTED_FACE_MODELS:
        return model_name
    return DEFAULT_MODEL_NAME


def _get_face_analysis(model_name: str | None) -> FaceAnalysis:
    model_name = _normalize_model_name(model_name)
    if model_name not in face_analysis_models:
        face_analysis_models[model_name] = FaceAnalysis(
            os.path.join(FACE_MODEL_ROOT, "models", model_name)
        )
    return face_analysis_models[model_name]


def _to_face_location(bbox: npt.NDArray[np.floating]) -> tuple[int, int, int, int]:
    left, top, right, bottom = bbox
    return (
        int(round(top)),
        int(round(right)),
        int(round(bottom)),
        int(round(left)),
    )


def _iou(
    face_location: tuple[int, int, int, int],
    detected_location: tuple[int, int, int, int],
) -> float:
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


def _find_best_face_match(
    face_locations: list[tuple[int, int, int, int]], detected_faces: list[Face]
) -> list[Face | None]:
    """The detected face at each requested location, None where there is none.

    One entry per location, in order. A location no detected face overlaps by
    MIN_FACE_MATCH_IOU is left unmatched rather than handed whichever face is
    left: its embedding would file the region under somebody else.
    """
    matches: list[Face | None] = []
    remaining_indices = set(range(len(detected_faces)))

    for face_location in face_locations:
        best_index: int | None = None
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
def create_face_encodings() -> ResponseReturnValue:
    source, face_locations, model_name = json_fields(
        "source", "face_locations", model_name=None
    )

    try:
        image = np.array(Image.open(source).convert("RGB"))
        face_analysis = _get_face_analysis(model_name)
        detected_faces = face_analysis.get(image)
        matched_faces = _find_best_face_match(face_locations, detected_faces)
        face_encodings_list = [
            None if face is None else face.embedding.tolist() for face in matched_faces
        ]
    except Exception as exc:
        log.error("error creating face_encodings for %s: %s", source, exc)
        return {"error": str(exc)}, 500

    matched = sum(encoding is not None for encoding in face_encodings_list)
    log.info("created face_encodings=%s/%s", matched, len(face_encodings_list))
    return {"encodings": face_encodings_list}, 200


@app.route("/face-locations", methods=["POST"])
def create_face_locations() -> ResponseReturnValue:
    source, model_name = json_fields("source", model_name=None)

    try:
        picture = Image.open(source)
    except (UnidentifiedImageError, Image.DecompressionBombError) as exc:
        # Not a picture this service can read: asking again gives the same
        # answer, so the backend marks the photo scanned instead of retrying
        # it on every Scan Faces (#2199). Every other failure is a 500.
        log.error("cannot read %s: %s", source, exc)
        return {"error": str(exc)}, 422

    try:
        image = np.array(picture.convert("RGB"))
        face_analysis = _get_face_analysis(model_name)
        faces = face_analysis.get(image)
        face_locations = [_to_face_location(face.bbox) for face in faces]
        # get() has already run recognition on every face it found. Handing
        # the embeddings back saves a /face-encodings call per face, each of
        # which ran detection and recognition over the whole picture again.
        face_encodings = [face.embedding.tolist() for face in faces]
    except Exception as exc:
        log.error("error creating face_locations for %s: %s", source, exc)
        return {"error": str(exc)}, 500

    log.info("created face_location=%s", face_locations)
    return {"face_locations": face_locations, "encodings": face_encodings}, 200


def serve() -> None:
    serve_forever(app, "face_recognition")


if __name__ == "__main__":
    serve()
