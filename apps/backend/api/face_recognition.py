import html
import re
from html.parser import HTMLParser

import numpy as np
import requests
from constance import config as site_config


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
            f"{response_text[:max_length]}..."
            f" [truncated {truncated_char_count} chars]"
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


def _post_to_face_service(url, payload):
    """POST to the face service and raise errors with response details."""
    response = requests.post(url, json=payload)

    try:
        response.raise_for_status()
    except requests.HTTPError as exc:
        raise requests.HTTPError(
            "Face recognition service request failed for "
            f"{url} with status {response.status_code}: "
            f"{_get_error_detail(response)}"
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
