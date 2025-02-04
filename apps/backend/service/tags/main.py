import time

import gevent
from flask import Flask, request
from gevent.pywsgi import WSGIServer
from places365.places365 import Places365

app = Flask(__name__)

places365_instance = None
last_request_time = None


def log(message):
    print(f"tags: {message}")


@app.route("/generate-tags", methods=["POST"])
def generate_tags():
    global last_request_time
    # Update last request time
    last_request_time = time.time()

    try:
        data = request.get_json()
        image_path = data["image_path"]
        confidence = data["confidence"]
    except Exception as e:
        print(str(e))
        return "", 400

    global places365_instance

    if places365_instance is None:
        places365_instance = Places365()
    return {"tags": places365_instance.inference_places365(image_path, confidence)}, 201


@app.route("/health", methods=["GET"])
def health():
    return {"last_request_time": last_request_time}, 200


if __name__ == "__main__":
    log("service starting")
    server = WSGIServer(("0.0.0.0", 8011), app)
    server_thread = gevent.spawn(server.serve_forever)
    gevent.joinall([server_thread])
