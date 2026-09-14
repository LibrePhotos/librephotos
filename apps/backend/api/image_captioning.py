import requests

from api.http_timeouts import CAPTION, HEALTH_CHECK

CAPTIONING_URL = "http://localhost:8007/generate-caption"


def generate_caption(image_path, prompt=None):
    """A caption for the photo from the image captioning sidecar.

    ``prompt`` steers the vision-language model; ``None`` asks for its plain
    one-sentence caption. Which model runs is the sidecar's business: there is
    one, and it is always available.
    """
    json_data = {"image_path": image_path}
    if prompt is not None:
        json_data["prompt"] = prompt

    caption_response = requests.post(
        CAPTIONING_URL, json=json_data, timeout=CAPTION
    ).json()

    return caption_response["caption"]


def unload_model():
    requests.get("http://localhost:8007/unload-model", timeout=HEALTH_CHECK)
