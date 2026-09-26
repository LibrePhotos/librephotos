from lfm2_vl import Lfm2VlCaptioner

from service._common import create_app, json_fields, logger, serve_forever

captioner = None
log = logger("image_captioning")


def get_captioner():
    global captioner
    if captioner is None:
        captioner = Lfm2VlCaptioner()
    return captioner


def unload_captioner():
    global captioner
    if captioner is not None:
        captioner.unload()
    captioner = None


app = create_app(
    "image_captioning",
    unload=unload_captioner,
    is_loaded=lambda: captioner is not None,
)


@app.route("/generate-caption", methods=["POST"])
def generate_caption():
    """A caption for ``image_path``, steered by the optional ``prompt``."""
    image_path, prompt = json_fields("image_path", prompt=None)

    try:
        return {"caption": get_captioner().caption(image_path, prompt)}, 200
    except Exception as e:
        # A captioner that failed half-way through loading must not be reused.
        global captioner
        captioner = None
        log(f"error captioning {image_path}: {e!r}")
        # The backend logs this message; it is the only place the reason
        # for a failed caption is visible without the sidecar's stdout.
        return {"error": f"{type(e).__name__}: {e}"}, 500


def serve():
    serve_forever(app, "image_captioning")


if __name__ == "__main__":
    serve()
