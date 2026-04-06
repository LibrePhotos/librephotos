import numpy as np
import requests
from constance import config as site_config


def get_face_encodings(image_path, known_face_locations):
    json = {
        "source": image_path,
        "face_locations": known_face_locations,
        "model_name": site_config.FACE_RECOGNITION_MODEL,
    }
    face_encoding = requests.post(
        "http://localhost:8005/face-encodings", json=json
    ).json()

    face_encodings_list = face_encoding["encodings"]
    face_encodings = [np.array(enc) for enc in face_encodings_list]

    return face_encodings


def get_face_locations(image_path, model="hog"):
    # `model` is kept for compatibility with existing callers, but the face service
    # now uses the selected InsightFace model pack from site settings.
    json = {
        "source": image_path,
        "model": model,
        "model_name": site_config.FACE_RECOGNITION_MODEL,
    }
    face_locations = requests.post(
        "http://localhost:8005/face-locations", json=json
    ).json()
    return face_locations["face_locations"]
