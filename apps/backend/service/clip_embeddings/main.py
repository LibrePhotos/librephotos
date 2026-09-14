import time

import gevent
import numpy as np
from clip_onnx import ClipEmbeddings
from flask import Flask, request
from gevent.pywsgi import WSGIServer

app = Flask(__name__)


def log(message):
    print(f"clip embeddings: {message}")


clip = ClipEmbeddings()
last_request_time = None


@app.route("/clip-embeddings", methods=["POST"])
def create_clip_embeddings():
    """Embeddings for a list of image paths.

    The response keeps one slot per requested path: an embedding and its
    magnitude, or ``null`` in both lists where the image could not be read,
    so the caller can match results to photos by position.
    """
    global last_request_time
    last_request_time = time.time()

    try:
        data = request.get_json()
        imgs = data["imgs"]
        model = data["model"]
    except Exception as e:
        print(str(e))
        return "", 400

    embeddings = clip.encode_images(imgs, model)
    imgs_emb = [None if e is None else e.tolist() for e in embeddings]
    magnitudes = [None if e is None else float(np.linalg.norm(e)) for e in embeddings]
    return {"imgs_emb": imgs_emb, "magnitudes": magnitudes}, 201


@app.route("/query-embeddings", methods=["POST"])
def calculate_query_embeddings():
    global last_request_time
    last_request_time = time.time()

    try:
        data = request.get_json()
        query = data["query"]
        model = data["model"]
    except Exception as e:
        print(str(e))
        return "", 400

    embedding = clip.encode_text(query, model)
    return {
        "emb": embedding.tolist(),
        "magnitude": float(np.linalg.norm(embedding)),
    }, 201


@app.route("/health", methods=["GET"])
def health():
    return {"last_request_time": last_request_time}, 200


if __name__ == "__main__":
    log("service starting")
    server = WSGIServer(("0.0.0.0", 8006), app)
    server_thread = gevent.spawn(server.serve_forever)
    gevent.joinall([server_thread])
