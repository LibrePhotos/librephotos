from constance import config as site_config

from api.llm import generate_visual_caption

def generate_caption(image_path, blip=False, prompt=None):
    if str(site_config.CAPTIONING_MODEL).strip().lower() == "none":
        return ""

    if prompt is None:
        prompt = "Describe this image in a short, concise caption."

    caption = generate_visual_caption(prompt=prompt, image_path=image_path)
    return caption or ""


def unload_model():
    return None
