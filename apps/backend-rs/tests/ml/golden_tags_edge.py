"""Edge-case goldens for lp_ml::tags: image modes and files the taggers meet.

    python golden_tags_edge.py

Complements golden_tags.py (fixture photos) with generated inputs: grey,
CMYK, progressive and EXIF-rotated JPEGs, RGBA / palette / 16-bit PNGs, GIF,
BMP, TIFF, lossless and alpha WebP, odd sizes, and broken files. Writes
ml-goldens/tags/edge.json (per model: the sidecar's tags and scores, or its
error) and, for every decodable image, Pillow's RGB pixels as
ml-goldens/_decoded/tags_edge/<name>.png so the Rust test can tell decoder
differences from model differences.

Also writes ml-goldens/tags/text_fresh.json: the tag embeddings of a sample of
prompts computed with the text tower in memory (not read from the
tag_embeddings.npy cache), so the cache-rebuild check does not depend on
whoever wrote the cache.
"""

import io
import os
import subprocess
import sys

if not sys.flags.utf8_mode:
    sys.exit(subprocess.call([sys.executable, "-X", "utf8", *sys.argv]))

import golden_common as gc  # noqa: E402

gc.setup("service/tags")

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

from mobileclip import mobileclip as mc  # noqa: E402
from siglip2 import siglip2 as sg  # noqa: E402

MODELS = {
    "mobileclip_s2": (mc.MobileCLIP, 0.02),
    "siglip2": (sg.SigLIP2, 0.05),
}

IMAGES = gc.GOLDENS / "_images" / "tags_edge"
DECODED = gc.GOLDENS / "_decoded" / "tags_edge"


def photo(w, h):
    """A smooth, photo-like RGB image with some structure."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    r = 128 + 100 * np.sin(x / 23.0) * np.cos(y / 31.0)
    g = 255 * y / max(h - 1, 1)
    b = 128 + 120 * np.sin((x + y) / 17.0)
    return np.clip(np.stack([r, g, b], -1), 0, 255).astype(np.uint8)


def make_images():
    import cv2

    IMAGES.mkdir(parents=True, exist_ok=True)
    base = Image.fromarray(photo(480, 320), "RGB")
    out = {}

    def save(name, fn):
        p = IMAGES / name
        if not p.exists():
            fn(p)
        out[name] = p

    save("gray.jpg", lambda p: base.convert("L").save(p, quality=90))
    save("cmyk.jpg", lambda p: base.convert("CMYK").save(p, quality=92))
    save("progressive.jpg", lambda p: base.save(p, quality=85, progressive=True))

    def exif_rotated(p):
        exif = Image.Exif()
        exif[0x0112] = 6  # Orientation: rotate 90 CW to display
        base.save(p, quality=90, exif=exif.tobytes())

    save("exif_orientation6.jpg", exif_rotated)

    def rgba(p):
        a = np.tile(np.linspace(0, 255, 480, dtype=np.float32), (320, 1)).astype(np.uint8)
        Image.fromarray(np.dstack([photo(480, 320), a]), "RGBA").save(p)

    save("rgba_alpha_ramp.png", rgba)

    def palette(p):
        img = base.quantize(64)
        img.info["transparency"] = 0
        img.save(p, transparency=0)

    save("palette_trns.png", palette)
    save("la.png", lambda p: base.convert("LA").save(p))
    save("rgb16.png", lambda p: cv2.imwrite(
        str(p), (photo(480, 320)[..., ::-1].astype(np.uint16) * 257 + 3)))
    save("gray16.png", lambda p: cv2.imwrite(
        str(p), (np.asarray(base.convert("L")).astype(np.uint16) * 257)))

    def gif(p):
        frames = [base.quantize(128), Image.fromarray(photo(480, 320)[::-1].copy()).quantize(128)]
        frames[0].save(p, save_all=True, append_images=frames[1:], duration=100)

    save("anim.gif", gif)
    save("plain.bmp", lambda p: base.save(p))
    save("plain.tif", lambda p: base.save(p))
    save("lossless.webp", lambda p: base.save(p, lossless=True))
    save("alpha.webp", lambda p: Image.open(IMAGES / "rgba_alpha_ramp.png").save(p, lossless=True))
    save("odd_257x256.png", lambda p: Image.fromarray(photo(257, 256)).save(p))
    save("odd_255x383.png", lambda p: Image.fromarray(photo(255, 383)).save(p))
    save("tiny_2x3.png", lambda p: Image.fromarray(photo(2, 3)).save(p))
    save("tall_90x1600.png", lambda p: Image.fromarray(photo(90, 1600)).save(p))

    def truncated(p):
        buf = io.BytesIO()
        base.save(buf, "JPEG", quality=90)
        p.write_bytes(buf.getvalue()[: len(buf.getvalue()) // 2])

    save("truncated.jpg", truncated)
    save("empty.jpg", lambda p: p.write_bytes(b""))
    save("not_an_image.jpg", lambda p: p.write_bytes(b"hello, this is text\n" * 10))
    return out


def fixture_sample():
    thumbs = sorted((gc.FIXTURE / "protected_media" / "thumbnails_big").glob("*.webp"))
    return {f"fixture_{p.name}": p for p in thumbs[:4]}


def pillow_rgb(path):
    try:
        return Image.open(path).convert("RGB")
    except Exception:
        return None


def scores(model, tagger, path):
    if model == "mobileclip_s2":
        emb = tagger.embed_image(path)
        return mc._softmax(mc.LOGIT_SCALE * (emb @ tagger.tag_embeddings.T)[0])
    pixel_values = tagger.prepare_image(Image.open(path))
    name = tagger.vision_session.get_inputs()[0].name
    raw = tagger.vision_session.run(None, {name: pixel_values})
    emb = sg._l2_normalize(sg._select_pooled_output(raw, 1))
    return (emb @ tagger.tag_embeddings.T)[0]


# Prompts for the fresh text check: the first ones, the non-ASCII ones and
# a stride through the rest.
def sample_tags(tags):
    idx = sorted(
        set(range(8))
        | {i for i, t in enumerate(tags) if not t.isascii()}
        | set(range(8, len(tags), 37))
    )
    return idx


def fresh_text(model, tagger, idx):
    prompts = [f"a photo of {tagger.tags[i]}" for i in idx]
    if model == "mobileclip_s2":
        session = mc.inference_session(mc.MOBILECLIP_TEXT_PATH)
        (raw,) = session.run(None, {session.get_inputs()[0].name: tagger._tokenize(prompts)})
        return mc._l2_normalize(raw)
    session = sg.inference_session(sg.SIGLIP2_TEXT_PATH)
    names = [i.name for i in session.get_inputs()]
    return sg._l2_normalize(tagger._encode_text_batch(session, names, prompts))


def main():
    images = {**make_images(), **fixture_sample()}
    DECODED.mkdir(parents=True, exist_ok=True)
    decoded = {}
    for name, path in images.items():
        img = pillow_rgb(path)
        if img is not None:
            out = DECODED / (name + ".png")
            img.save(out)
            decoded[name] = str(out)

    cases = []
    text_cases = []
    for model, (cls, threshold) in MODELS.items():
        tagger = cls()
        tagger.load()
        for name, path in images.items():
            try:
                tags = tagger.predict(str(path), threshold=threshold, max_tags=10)
                out = {"tags": tags, "scores": gc.arr(scores(model, tagger, str(path)))}
            except Exception as e:  # the sidecar answers 500
                out = {"error": f"{type(e).__name__}: {e}"}
            print(model, name, out.get("tags", out.get("error")))
            cases.append(
                gc.case(
                    f"{model}/{name}",
                    {"model": model, "image": str(path), "decoded": decoded.get(name)},
                    out,
                )
            )
        idx = sample_tags(tagger.tags)
        emb = fresh_text(model, tagger, idx)
        text_cases.append(
            gc.case(model, {"indices": idx}, {"embeddings": gc.arr(emb.astype(np.float32))})
        )
    gc.write("tags", "edge", cases)
    gc.write("tags", "text_fresh", text_cases)


if __name__ == "__main__":
    main()
