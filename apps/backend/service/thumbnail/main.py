import os

import pyvips
import rawpy
from flask.typing import ResponseReturnValue

from librephotos.env import protected_media_root
from service._common import (
    MalformedRequest,
    create_app,
    json_fields,
    logger,
    serve_forever,
)

app = create_app("thumbnail")
log = logger("thumbnail")

# Thumbnails are written only under the media root the backend serves them
# from.
MEDIA_ROOT = protected_media_root()

# WebP quality when the request names none (the backend sends
# BIG_THUMBNAIL_QUALITY).
DEFAULT_QUALITY = 95


def render_raw(
    source: str, destination: str, height: int, quality: int = DEFAULT_QUALITY
) -> None:
    """Decode a RAW file with LibRaw and save a WebP thumbnail of the given height."""
    with rawpy.imread(source) as raw:
        # Half-size demosaic is 4x faster and still above the target height.
        half = raw.sizes.height // 2 >= height
        rgb = raw.postprocess(use_camera_wb=True, half_size=half, output_bps=8)
    image = pyvips.Image.new_from_array(rgb)
    thumbnail = image.thumbnail_image(10000, height=height, size=pyvips.enums.Size.DOWN)
    # Built from bare pixels, so nothing of the photo's own metadata is here, but
    # libvips would still add a stock EXIF block; thumbnails carry none (see
    # ``api.thumbnails.render.WEBP``).
    thumbnail.webpsave(destination, Q=quality, keep=pyvips.enums.ForeignKeep.NONE)


def _quality(value: object) -> int:
    """The requested WebP quality: a whole number, clamped to 1-100."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise MalformedRequest("quality must be a whole number")
    return min(100, max(1, value))


def _inside_media_root(destination: str) -> bool:
    """Whether *destination*, symlinks and ``..`` resolved, is under MEDIA_ROOT."""
    root = os.path.realpath(MEDIA_ROOT)
    try:
        path = os.path.realpath(destination)
        return os.path.commonpath([root, path]) == root
    except (TypeError, ValueError):
        # Not a path, or on another drive than the media root.
        return False


@app.route("/", methods=["POST"])
def create_thumbnail() -> ResponseReturnValue:
    source, destination, height, quality = json_fields(
        "source", "destination", "height", quality=DEFAULT_QUALITY
    )
    quality = _quality(quality)
    # Anything that reaches the port could otherwise overwrite any file the
    # service can write to.
    if not _inside_media_root(destination):
        log.warning("refused destination outside %s: %s", MEDIA_ROOT, destination)
        return {"error": "destination is outside the media root"}, 400
    log.info("creating for source=%s height=%s", source, height)
    try:
        render_raw(source, destination, height, quality)
    except Exception as e:
        log.error("error creating a thumbnail of %s: %r", source, e)
        return {"error": f"{type(e).__name__}: {e}"}, 500
    log.info("created at location=%s", destination)
    # 201: unlike the other sidecars' answers, this one made a file.
    return {"thumbnail": destination}, 201


def serve() -> None:
    serve_forever(app, "thumbnail")


if __name__ == "__main__":
    serve()
