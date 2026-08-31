import requests
from constance import config as site_config

from api.http_timeouts import CAPTION, HEALTH_CHECK


DEFAULT_MOONDREAM_PROMPT = "Describe this image in a short, concise caption."


def _generate_caption_moondream(image_path, prompt):
    json_data = {
        "image_path": image_path,
        "prompt": DEFAULT_MOONDREAM_PROMPT if prompt is None else prompt,
        "max_tokens": 256,
    }
    try:
        response = requests.post(
            "http://localhost:8008/generate", json=json_data, timeout=CAPTION
        )

        if response.status_code != 201:
            print(
                f"Error with Moondream captioning service: HTTP {response.status_code} - {response.text}"
            )
            return "Error generating caption with Moondream: Service unavailable"

        return response.json()["response"]
    except requests.exceptions.ConnectionError:
        print(
            "Error with Moondream captioning service: Cannot connect to LLM service on port 8008"
        )
        return "Error generating caption with Moondream: Service unavailable"
    except requests.exceptions.Timeout:
        print("Error with Moondream captioning service: Request timeout")
        return "Error generating caption with Moondream: Request timeout"
    except Exception as e:
        print(f"Error with Moondream captioning service: {e}")
        return "Error generating caption with Moondream"


def _generate_caption_sidecar(image_path, blip):
    json_data = {
        "image_path": image_path,
        "onnx": False,
        "blip": blip,
    }
    caption_response = requests.post(
        "http://localhost:8007/generate-caption", json=json_data, timeout=CAPTION
    ).json()

    return caption_response["caption"]


def generate_caption(image_path, blip=False, prompt=None):
    if site_config.CAPTIONING_MODEL == "moondream":
        return _generate_caption_moondream(image_path, prompt)

    return _generate_caption_sidecar(image_path, blip)


def unload_model():
    requests.get("http://localhost:8007/unload-model", timeout=HEALTH_CHECK)
