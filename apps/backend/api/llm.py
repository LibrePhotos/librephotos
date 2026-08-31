import requests
import base64
import io
from PIL import Image
from constance import config as site_config

from api.http_timeouts import LLM_GEN

MODEL_PATHS = {
    "moondream": "/protected_media/data_models/moondream2-text-model-f16.gguf",
    "mistral-7b-instruct-v0.2.Q5_K_M": (
        "/protected_media/data_models/mistral-7b-instruct-v0.2.Q5_K_M.gguf"
    ),
}


def image_to_base64_data_uri(image_path):
    """Convert image file to base64 data URI, converting to JPEG for compatibility"""
    try:
        # Open image with PIL and convert to RGB (handles WebP, PNG with transparency, etc.)
        with Image.open(image_path) as img:
            # Convert to RGB mode (removes alpha channel if present)
            if img.mode != "RGB":
                img = img.convert("RGB")

            # Save as JPEG to memory buffer
            buffer = io.BytesIO()
            img.save(buffer, format="JPEG", quality=95)
            buffer.seek(0)

            # Encode to base64
            image_data = base64.b64encode(buffer.getvalue()).decode("utf-8")

        return f"data:image/jpeg;base64,{image_data}"
    except Exception as e:
        print(f"Error converting image to data URI: {str(e)}")
        raise


def build_generation_payload(prompt, model_path, image_path):
    json_data = {
        "model_path": model_path,
        "max_tokens": 64,
        "prompt": prompt,
    }

    if image_path:
        json_data["image_data"] = image_to_base64_data_uri(image_path)
        json_data["multimodal"] = True

    return json_data


def request_generation(json_data):
    response = requests.post(
        "http://localhost:8008/generate", json=json_data, timeout=LLM_GEN
    )

    if response.status_code != 201:
        print(f"Error with LLM service: HTTP {response.status_code} - {response.text}")
        return None

    return response.json().get("response", "")


def generate_prompt(prompt, image_path=None):
    model_path = MODEL_PATHS.get(site_config.LLM_MODEL)
    if model_path is None:
        return None

    try:
        json_data = build_generation_payload(prompt, model_path, image_path)
    except Exception as e:
        print(f"Error converting image: {e}")
        return None

    try:
        return request_generation(json_data)
    except requests.exceptions.ConnectionError:
        print("Error with LLM service: Cannot connect to service on port 8008")
        return None
    except requests.exceptions.Timeout:
        print("Error with LLM service: Request timeout")
        return None
    except Exception as e:
        print(f"Error with LLM service: {e}")
        return None
