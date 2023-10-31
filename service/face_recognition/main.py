import gevent
from flask import Flask, request
from gevent.pywsgi import WSGIServer
import face_recognition
import numpy as np
import PIL

app = Flask(__name__)


def log(message):
    print("face_recognition: {}".format(message))


@app.route("/face-encodings", methods=["POST"])
def create_face_encodings():
    try:
        data = request.get_json()
        source = data["source"]
        face_locations = data["face_locations"]
    except Exception:
        return "", 400

    image = np.array(PIL.Image.open(source))
    face_encodings = face_recognition.face_encodings(
        image,
        known_face_locations=face_locations,
    )
    # Convert NumPy arrays to Python lists
    face_encodings_list = [enc.tolist() for enc in face_encodings]
    # Log number of face encodings
    log(f"created face_encodings={len(face_encodings_list)}")
    return {"encodings": face_encodings_list}, 201


@app.route("/face-locations", methods=["POST"])
def create_face_locations():
    try:
        data = request.get_json()
        source = data["source"]
        model = data["model"]
    except Exception:
        return "", 400

    image = np.array(PIL.Image.open(source))
    face_locations = face_recognition.face_locations(image, model=model)
    log(f"created face_location={face_locations}")
    return {"face_locations": face_locations}, 201


if __name__ == "__main__":
    log("service starting")
    server = WSGIServer(("0.0.0.0", 8005), app)
    server_thread = gevent.spawn(server.serve_forever)
    gevent.joinall([server_thread])
