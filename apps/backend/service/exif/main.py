import exiftool
import gevent
from flask import Flask, request
from gevent.pywsgi import WSGIServer

static_et = exiftool.ExifTool()
static_struct_et = exiftool.ExifTool(common_args=["-struct"])

app = Flask(__name__)


def log(message):
    print(f"exif: {message}")


@app.route("/get-tags", methods=["POST"])
def get_tags():
    try:
        data = request.get_json()
        files_by_reverse_priority = data["files_by_reverse_priority"]
        tags = data["tags"]
        struct = data["struct"]
    except Exception:
        return "", 400

    et = None
    if struct:
        et = static_struct_et
    else:
        et = static_et
    if not et.running:
        et.start()

    values = []
    try:
        for tag in tags:
            value = None
            for file in files_by_reverse_priority:
                retrieved_value = et.get_tag(tag, file)
                if retrieved_value is not None:
                    value = retrieved_value
            values.append(value)
    except Exception:
        log("An error occurred")

    return {"values": values}, 201


@app.route("/health", methods=["GET"])
def health():
    return {"status": "OK"}, 200


if __name__ == "__main__":
    log("service starting")
    server = WSGIServer(("0.0.0.0", 8010), app)
    server_thread = gevent.spawn(server.serve_forever)
    gevent.joinall([server_thread])
