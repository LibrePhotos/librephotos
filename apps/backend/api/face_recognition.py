import numpy as np
import requests
from constance import config as site_config


def _get_response_preview(response, max_length=500):
    """Return a trimmed face-service response body preview for error messages."""
    response_text = response.text.strip()
    if not response_text:
        return "<empty body>"
    if len(response_text) > max_length:
        truncated_char_count = len(response_text) - max_length
        return (
            f"{response_text[:max_length]}..."
            f" [truncated {truncated_char_count} chars]"
        )
    return response_text


def _post_to_face_service(url, payload):
    """POST to the face service and raise errors with response details."""
    response = requests.post(url, json=payload)

    try:
        response.raise_for_status()
    except requests.HTTPError as exc:
        raise requests.HTTPError(
            "Face recognition service request failed for "
            f"{url} with status {response.status_code}: "
            f"{_get_response_preview(response)}"
        ) from exc

    try:
        return response.json()
    except ValueError as exc:
        raise ValueError(
            "Face recognition service returned invalid JSON for "
            f"{url} with status {response.status_code}: "
            f"{_get_response_preview(response)}"
        ) from exc


def get_face_encodings(image_path, known_face_locations):
    payload = {
        "source": image_path,
        "face_locations": known_face_locations,
        "model_name": site_config.FACE_RECOGNITION_MODEL,
    }
    face_encoding = _post_to_face_service(
        "http://localhost:8005/face-encodings", payload
    )

    face_encodings_list = face_encoding["encodings"]
    face_encodings = [np.array(enc) for enc in face_encodings_list]

    return face_encodings


def get_face_locations(image_path):
    payload = {
        "source": image_path,
        "model_name": site_config.FACE_RECOGNITION_MODEL,
    }
    face_locations = _post_to_face_service(
        "http://localhost:8005/face-locations", payload
    )
    return face_locations["face_locations"]
