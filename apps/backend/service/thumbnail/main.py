import os

import pyvips
import rawpy

from service._common import create_app, json_fields, logger, serve_forever

app = create_app("thumbnail")
log = logger("thumbnail")

# Thumbnails are written only under the media root the backend serves them
# from. The sidecars never load Django, so the data root comes in as BASE_DATA
# (see api.services._service_environment). Unset, this is the Docker layout.
MEDIA_ROOT = os.path.join(os.environ.get("BASE_DATA", os.sep), "protected_media")


def render_raw(source, destination, height):
    """Decode a RAW file with LibRaw and save a WebP thumbnail of the given height."""
    with rawpy.imread(source) as raw:
        # Half-size demosaic is 4x faster and still above the target height.
        half = raw.sizes.height // 2 >= height
        rgb = raw.postprocess(use_camera_wb=True, half_size=half, output_bps=8)
    image = pyvips.Image.new_from_array(rgb)
    thumbnail = image.thumbnail_image(10000, height=height, size=pyvips.enums.Size.DOWN)
    thumbnail.webpsave(destination, Q=95)


def _inside_media_root(destination):
    """Whether *destination*, symlinks and ``..`` resolved, is under MEDIA_ROOT."""
    root = os.path.realpath(MEDIA_ROOT)
    try:
        path = os.path.realpath(destination)
        return os.path.commonpath([root, path]) == root
    except (TypeError, ValueError):
        # Not a path, or on another drive than the media root.
        return False


@app.route("/", methods=["POST"])
def create_thumbnail():
    source, destination, height = json_fields("source", "destination", "height")
    # Anything that reaches the port could otherwise overwrite any file the
    # service can write to.
    if not _inside_media_root(destination):
        log(f"refused destination outside {MEDIA_ROOT}: {destination}")
        return {"error": "destination is outside the media root"}, 400
    log(f"creating for source={source} height={height}")
    try:
        render_raw(source, destination, height)
    except Exception as e:
        log(f"error creating a thumbnail of {source}: {e!r}")
        return {"error": f"{type(e).__name__}: {e}"}, 500
    log(f"created at location={destination}")
    # 201: unlike the other sidecars' answers, this one made a file.
    return {"thumbnail": destination}, 201


def serve():
    serve_forever(app, "thumbnail")


if __name__ == "__main__":
    serve()
