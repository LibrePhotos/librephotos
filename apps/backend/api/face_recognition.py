import numpy as np
import requests


def get_face_encodings(image_path, known_face_locations):
    json = {
        "source": image_path,
        "face_locations": known_face_locations,
    }
    face_encoding = requests.post(
        "http://localhost:8005/face-encodings", json=json
    ).json()

    face_encodings_list = face_encoding["encodings"]
    face_encodings = [np.array(enc) for enc in face_encodings_list]

    return face_encodings


def get_face_locations(image_path, model="hog"):
    json = {"source": image_path, "model": model}
    face_locations = requests.post(
        "http://localhost:8005/face-locations", json=json
    ).json()
    return face_locations["face_locations"]
