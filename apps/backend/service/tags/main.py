import time

import gevent
from flask import Flask, request
from gevent.pywsgi import WSGIServer
from places365.places365 import Places365
from siglip2.siglip2 import SigLIP2

app = Flask(__name__)

places365_instance = None
siglip2_instance = None
last_request_time = None


def log(message):
    print(f"tags: {message}")


def parse_tag_request():
    data = request.get_json()
    return (
        data["image_path"],
        data.get("confidence", 0.4),
        data.get("tagging_model", "places365"),
    )


def tag_with_siglip2(image_path, confidence):
    global siglip2_instance
    if siglip2_instance is None:
        siglip2_instance = SigLIP2()
    # SigLIP 2 uses cosine similarity (range -1 to 1), not probability scores.
    # Always return the top 10 most relevant tags above a minimum threshold.
    return siglip2_instance.predict(image_path, threshold=0.05, max_tags=10)


def tag_with_places365(image_path, confidence):
    global places365_instance
    if places365_instance is None:
        places365_instance = Places365()
    return places365_instance.inference_places365(image_path, confidence)


@app.route("/generate-tags", methods=["POST"])
def generate_tags():
    global last_request_time
    last_request_time = time.time()

    try:
        image_path, confidence, tagging_model = parse_tag_request()
    except Exception as e:
        print(str(e))
        return "", 400

    tagger = tag_with_siglip2 if tagging_model == "siglip2" else tag_with_places365
    try:
        return {"tags": tagger(image_path, confidence)}, 201
    except Exception as e:
        print(f"tags: Error processing image {image_path}: {e}")
        return {"error": "Failed to process image"}, 500


@app.route("/health", methods=["GET"])
def health():
    return {"last_request_time": last_request_time}, 200


if __name__ == "__main__":
    log("service starting")
    server = WSGIServer(("0.0.0.0", 8011), app)
    server_thread = gevent.spawn(server.serve_forever)
    gevent.joinall([server_thread])
