import threading
import time

import gevent
from flask import Flask, request
from gevent.pywsgi import WSGIServer

from api.im2txt.sample import Im2txt

app = Flask(__name__)

im2txt_instance = None
last_request_time = time.time()


def log(message):
    print("image_captioning: {}".format(message))


@app.route("/generate-caption", methods=["POST"])
def generate_caption():
    global last_request_time
    # Update last request time
    last_request_time = time.time()

    try:
        data = request.get_json()
        image_path = data["image_path"]
        onnx = data["onnx"]
        blip = data["blip"]
    except Exception as e:
        print(str(e))
        return "", 400

    global im2txt_instance

    if im2txt_instance is None:
        im2txt_instance = Im2txt(blip=blip)

    return {
        "caption": im2txt_instance.generate_caption(image_path=image_path, onnx=onnx)
    }, 201


@app.route("/unload-model", methods=["GET"])
def unload_model():
    global im2txt_instance
    im2txt_instance.unload_models()
    im2txt_instance = None
    return "", 200


@app.route("/export-onnx", methods=["GET"])
def export_onnx():
    global im2txt_instance
    if im2txt_instance is None:
        im2txt_instance = Im2txt()
    data = request.get_json()
    encoder_path = data["encoder_path"]
    decoder_path = data["decoder_path"]
    im2txt_instance.export_onnx(
        encoder_output_path=encoder_path, decoder_output_path=decoder_path
    )
    return "", 200


def check_inactivity():
    global last_request_time
    idle_threshold = 30

    while True:
        time.sleep(1)
        idle_time = time.time() - last_request_time
        if idle_time > idle_threshold and im2txt_instance is not None:
            print("Unloading model due to inactivity")
            unload_model()


threading.Thread(target=check_inactivity).start()


if __name__ == "__main__":
    log("service starting")
    server = WSGIServer(("0.0.0.0", 8007), app)
    server_thread = gevent.spawn(server.serve_forever)
    gevent.joinall([server_thread])
