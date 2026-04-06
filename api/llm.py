import requests
import base64
import io
from PIL import Image
from constance import config as site_config


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


def _normalized_llm_model_name():
    return str(site_config.LLM_MODEL).strip().lower()


def generate_moondream_caption(prompt, image_path, max_tokens=256):
    json_data = {
        "model_path": "/protected_media/data_models/moondream2-text-model-f16.gguf",
        "max_tokens": max_tokens,
        "prompt": prompt,
        "multimodal": True,
    }

    try:
        json_data["image_data"] = image_to_base64_data_uri(image_path)
    except Exception as e:
        print(f"Error converting image: {e}")
        return None

    try:
        response = requests.post("http://localhost:8008/generate", json=json_data)

        if response.status_code != 201:
            print(
                f"Error with Moondream service: HTTP {response.status_code} - {response.text}"
            )
            return None

        response_data = response.json()
        return response_data.get("response", "")
    except requests.exceptions.ConnectionError:
        print("Error with Moondream service: Cannot connect to service on port 8008")
        return None
    except requests.exceptions.Timeout:
        print("Error with Moondream service: Request timeout")
        return None
    except Exception as e:
        print(f"Error with Moondream service: {e}")
        return None


def generate_prompt(prompt, image_path=None):
    llm_model = _normalized_llm_model_name()

    if llm_model == "none":
        return None

    # Use the unified LLM service for all models including Moondream
    if llm_model == "moondream":
        model_path = "/protected_media/data_models/moondream2-text-model-f16.gguf"
    elif llm_model == "mistral-7b-instruct-v0.2.q5_k_m":
        model_path = "/protected_media/data_models/mistral-7b-instruct-v0.2.Q5_K_M.gguf"
    else:
        return None

    json_data = {
        "model_path": model_path,
        "max_tokens": 64,
        "prompt": prompt,
    }

    # Convert image to base64 data URI if image path is provided
    if image_path:
        try:
            image_data = image_to_base64_data_uri(image_path)
            json_data["image_data"] = image_data
            json_data["multimodal"] = True
        except Exception as e:
            print(f"Error converting image: {e}")
            return None

    try:
        response = requests.post("http://localhost:8008/generate", json=json_data)

        if response.status_code != 201:
            print(
                f"Error with LLM service: HTTP {response.status_code} - {response.text}"
            )
            return None

        response_data = response.json()
        return response_data.get("response", "")
    except requests.exceptions.ConnectionError:
        print("Error with LLM service: Cannot connect to service on port 8008")
        return None
    except requests.exceptions.Timeout:
        print("Error with LLM service: Request timeout")
        return None
    except Exception as e:
        print(f"Error with LLM service: {e}")
        return None
