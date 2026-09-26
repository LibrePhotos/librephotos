import requests

from api.http_timeouts import CAPTION, HEALTH_CHECK
from api.sidecars import sidecar_url

CAPTIONING_URL = sidecar_url(8007, "/generate-caption")


class CaptionError(RuntimeError):
    """The captioning sidecar answered, but not with a caption."""


def generate_caption(image_path, prompt=None):
    """A caption for the photo from the image captioning sidecar.

    ``prompt`` steers the vision-language model; ``None`` asks for its plain
    one-sentence caption. Which model runs is the sidecar's business: there is
    one, and it is always available.

    Raises ``CaptionError`` carrying the sidecar's own error message when it
    could not caption the photo, so the reason (a missing model file, an
    ONNX Runtime failure) ends up in the backend log instead of a bare
    ``KeyError: 'caption'``. Connection and timeout errors propagate as-is.
    """
    json_data = {"image_path": image_path}
    if prompt is not None:
        json_data["prompt"] = prompt

    response = requests.post(CAPTIONING_URL, json=json_data, timeout=CAPTION)

    try:
        body = response.json()
    except ValueError:
        body = {}
    if not isinstance(body, dict):
        body = {}

    if response.status_code >= 400 or "caption" not in body:
        detail = body.get("error") or response.text.strip() or "no caption in reply"
        raise CaptionError(
            f"captioning sidecar returned HTTP {response.status_code}: {detail}"
        )

    return body["caption"]


def unload_model():
    requests.get(sidecar_url(8007, "/unload-model"), timeout=HEALTH_CHECK)
