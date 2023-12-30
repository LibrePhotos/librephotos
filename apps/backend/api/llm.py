import requests

model_path = "/protected_media/data_models/mistral-7b-v0.1.Q5_K_M.gguf"


def generate_prompt(prompt):
    json = {
        "model_path": model_path,
        "max_tokens": 64,
        "prompt": prompt,
    }
    caption_response = requests.post("http://localhost:8008/", json=json).json()

    return caption_response["prompt"]["choices"][0]["text"]
