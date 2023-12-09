import requests


def generate_caption(image_path, onnx, blip):
    json = {
        "image_path": image_path,
        "onnx": onnx,
        "blip": blip,
    }
    caption_response = requests.post(
        "http://localhost:8007/generate-caption", json=json
    ).json()

    return caption_response["caption"]


def unload_model():
    requests.get("http://localhost:8007/unload-model")


def export_onnx(encoder_path, decoder_path):
    json = {
        "encoder_path": encoder_path,
        "decoder_path": decoder_path,
    }
    requests.get("http://localhost:8007/export-onnx", json=json)
