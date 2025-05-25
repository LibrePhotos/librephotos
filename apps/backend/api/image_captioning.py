import requests
from constance import config as site_config


def generate_caption(image_path, blip=False, prompt=None):
    # Check if Moondream is selected as captioning model
    if site_config.CAPTIONING_MODEL == "moondream":
        # Use custom prompt if provided, otherwise use default caption prompt
        if prompt is None:
            prompt = "Describe this image in a short, concise caption."
            
        json_data = {
            "image_path": image_path,
            "prompt": prompt,
            "max_tokens": 256,
        }
        try:
            response = requests.post(
                "http://localhost:8008/generate", json=json_data
            )
            
            if response.status_code != 201:
                print(f"Error with Moondream captioning service: HTTP {response.status_code} - {response.text}")
                return "Error generating caption with Moondream: Service unavailable"
            
            response_data = response.json()
            return response_data["response"]
        except requests.exceptions.ConnectionError:
            print("Error with Moondream captioning service: Cannot connect to LLM service on port 8008")
            return "Error generating caption with Moondream: Service unavailable"
        except requests.exceptions.Timeout:
            print("Error with Moondream captioning service: Request timeout")
            return "Error generating caption with Moondream: Request timeout"
        except Exception as e:
            print(f"Error with Moondream captioning service: {e}")
            return "Error generating caption with Moondream"
    
    # Original implementation for other models
    json_data = {
        "image_path": image_path,
        "onnx": False,
        "blip": blip,
    }
    caption_response = requests.post(
        "http://localhost:8007/generate-caption", json=json_data
    ).json()

    return caption_response["caption"]


def unload_model():
    requests.get("http://localhost:8007/unload-model")



