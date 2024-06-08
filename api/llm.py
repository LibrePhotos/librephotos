import requests
from constance import config as site_config


def generate_prompt(prompt):
    if site_config.LLM_MODEL == "none":
        return None
    if site_config.LLM_MODEL == "mistral-7b-v0.1.Q5_K_M":
        model_path = "/protected_media/data_models/mistral-7b-v0.1.Q5_K_M.gguf"
    if site_config.LLM_MODEL == "mistral-7b-instruct-v0.2.Q5_K_M":
        model_path = "/protected_media/data_models/mistral-7b-instruct-v0.2.Q5_K_M.gguf"

    json = {
        "model_path": model_path,
        "max_tokens": 64,
        "prompt": prompt,
    }
    caption_response = requests.post("http://localhost:8008/", json=json).json()

    print(caption_response)

    return caption_response["prompt"]["choices"][0]["text"]
