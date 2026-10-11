from typing import Any

import requests

from api import sidecars
from api.http_timeouts import CAPTION


class CaptionError(RuntimeError):
    """The captioning sidecar answered, but not with a caption."""


def generate_caption(image_path: str, prompt: str | None = None) -> str:
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

    try:
        response = sidecars.post(
            "image_captioning", "/generate-caption", json=json_data, timeout=CAPTION
        )
    except requests.HTTPError as error:
        failed = error.response
        # sidecars.post raises only through raise_for_status(), which always
        # attaches the response.
        assert failed is not None
        raise CaptionError(
            f"captioning sidecar returned HTTP {failed.status_code}: {_detail(failed)}"
        ) from error

    body = _body(response)
    if "caption" not in body:
        raise CaptionError(
            f"captioning sidecar returned HTTP {response.status_code}: "
            f"{_detail(response)}"
        )
    return body["caption"]


def _body(response: requests.Response) -> dict[str, Any]:
    try:
        body = response.json()
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


def _detail(response: requests.Response) -> str:
    return (
        _body(response).get("error") or response.text.strip() or "no caption in reply"
    )
