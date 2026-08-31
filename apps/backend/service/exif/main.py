import exiftool
import gevent
from flask import Flask, request
from gevent.pywsgi import WSGIServer

static_et = exiftool.ExifTool()
static_struct_et = exiftool.ExifTool(common_args=["-struct"])

app = Flask(__name__)


def log(message):
    print(f"exif: {message}")


def parse_get_tags_request():
    try:
        data = request.get_json()
        return (
            data["files_by_reverse_priority"],
            data["tags"],
            data["struct"],
        )
    except Exception:
        return None


def running_exiftool(struct):
    et = static_struct_et if struct else static_et
    if not et.running:
        et.start()
    return et


def highest_priority_value(et, tag, files_by_reverse_priority):
    value = None
    for file in files_by_reverse_priority:
        retrieved_value = et.get_tag(tag, file)
        if retrieved_value is not None:
            value = retrieved_value
    return value


@app.route("/get-tags", methods=["POST"])
def get_tags():
    payload = parse_get_tags_request()
    if payload is None:
        return "", 400
    files_by_reverse_priority, tags, struct = payload

    et = running_exiftool(struct)

    values = []
    try:
        for tag in tags:
            values.append(highest_priority_value(et, tag, files_by_reverse_priority))
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
