import gevent
import pyvips
import rawpy
from flask import Flask, request
from gevent.pywsgi import WSGIServer

app = Flask(__name__)


def log(message):
    print(f"thumbnail: {message}")


def render_raw(source, destination, height):
    """Decode a RAW file with LibRaw and save a WebP thumbnail of the given height."""
    with rawpy.imread(source) as raw:
        # Half-size demosaic is 4x faster and still above the target height.
        half = raw.sizes.height // 2 >= height
        rgb = raw.postprocess(use_camera_wb=True, half_size=half, output_bps=8)
    image = pyvips.Image.new_from_array(rgb)
    thumbnail = image.thumbnail_image(10000, height=height, size=pyvips.enums.Size.DOWN)
    thumbnail.webpsave(destination, Q=95)


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
    render_raw(source, destination, height)
    log(f"created at location={destination}")
    return {"thumbnail": destination}, 201


@app.route("/health", methods=["GET"])
def health():
    return {"status": "OK"}, 200


def serve():
    log("service starting")
    server = WSGIServer(("0.0.0.0", 8003), app)
    server_thread = gevent.spawn(server.serve_forever)
    gevent.joinall([server_thread])


if __name__ == "__main__":
    serve()
