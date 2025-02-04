import gevent
from flask import Flask, request
from gevent.pywsgi import WSGIServer
from wand.image import Image

app = Flask(__name__)


def log(message):
    print(f"thumbnail: {message}")


@app.route("/", methods=["POST"])
def create_thumbnail():
    try:
        data = request.get_json()
        source = data["source"]
        destination = data["destination"]
        height = data["height"]
    except Exception:
        return "", 400
    log(f"creating for source={source} height={height}")
    with Image(filename=source) as img:
        with img.clone() as thumbnail:
            thumbnail.format = "webp"
            thumbnail.transform(resize=f"x{height}")
            thumbnail.compression_quality = 95
            thumbnail.auto_orient()
            thumbnail.save(filename=destination)
    log(f"created at location={destination}")
    return {"thumbnail": destination}, 201


@app.route("/health", methods=["GET"])
def health():
    return {"status": "OK"}, 200


if __name__ == "__main__":
    log("service starting")
    server = WSGIServer(("0.0.0.0", 8003), app)
    server_thread = gevent.spawn(server.serve_forever)
    gevent.joinall([server_thread])
