import html
import re
from html.parser import HTMLParser

import numpy as np
import requests
from constance import config as site_config

from api import sidecars


class _HTMLTextExtractor(HTMLParser):
    """Minimal HTML parser that collects visible text content."""

    def __init__(self):
        super().__init__()
        self._parts = []

    def handle_data(self, data):
        self._parts.append(data)

    def get_text(self):
        return " ".join(part.strip() for part in self._parts if part.strip())


def _strip_html(text):
    """Strip HTML tags and decode entities, returning plain text."""
    parser = _HTMLTextExtractor()
    parser.feed(text)
    plain = parser.get_text()
    # Collapse extra whitespace left after stripping tags
    plain = re.sub(r"\s+", " ", plain).strip()
    return html.unescape(plain) if plain else text.strip()


def _get_response_preview(response, max_length=500):
    """Return a trimmed face-service response body preview for error messages.

    HTML responses (e.g. Flask error pages) are converted to plain text so
    the resulting log line is human-readable.
    """
    response_text = response.text.strip()
    if not response_text:
        return "<empty body>"

    content_type = response.headers.get("Content-Type", "")
    if "html" in content_type or response_text.lstrip().startswith("<"):
        response_text = _strip_html(response_text)
        if not response_text:
            return "<empty body>"

    if len(response_text) > max_length:
        truncated_char_count = len(response_text) - max_length
        return (
            f"{response_text[:max_length]}... [truncated {truncated_char_count} chars]"
        )
    return response_text


def _get_error_detail(response):
    """Return the most useful error detail from a failed response.

    Prefers the ``error`` field from a JSON body (as returned by the face
    service itself) and falls back to the plain-text preview helper.
    """
    try:
        body = response.json()
        if isinstance(body, dict) and body.get("error"):
            return body["error"]
    except ValueError:
        pass
    return _get_response_preview(response)


def _post_to_face_service(path, payload):
    """POST to the face service and raise errors with response details.

    The sidecar can drop the connection while a scan saturates the box; the
    shared client (api.sidecars) retries that, so one blip does not fail a
    face and, accumulated, a whole Scan Faces job. Status (HTTP) and body
    (JSON) errors would fail the same way again, and are raised with the URL,
    the status and the sidecar's reply.
    """
    from api.http_timeouts import FACE

    url = sidecars.sidecar_url("face_recognition", path)
    try:
        response = sidecars.post("face_recognition", path, json=payload, timeout=FACE)
    except requests.HTTPError as exc:
        response = exc.response
        raise requests.HTTPError(
            "Face recognition service request failed for "
            f"{url} with status {response.status_code}: "
            f"{_get_error_detail(response)}",
            response=response,
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
    face_encoding = _post_to_face_service("/face-encodings", payload)

    # One per location; None where the sidecar detected no face there.
    return [
        None if encoding is None else np.array(encoding)
        for encoding in face_encoding["encodings"]
    ]


def detect_faces(image_path):
    """Every face in the picture: [(location, encoding)], encoding None if not sent.

    The sidecar computes the encodings while detecting; a sidecar from before
    it sent them leaves them to ``Face.generate_encoding``.
    """
    payload = {
        "source": image_path,
        "model_name": site_config.FACE_RECOGNITION_MODEL,
    }
    response = _post_to_face_service("/face-locations", payload)
    locations = response["face_locations"]
    encodings = response.get("encodings") or []
    if len(encodings) != len(locations):
        encodings = [None] * len(locations)
    return [
        (location, None if encoding is None else np.array(encoding))
        for location, encoding in zip(locations, encodings)
    ]


def get_face_locations(image_path):
    return [location for location, _ in detect_faces(image_path)]
