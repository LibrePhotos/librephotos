"""Goldens for the in-process PP-OCRv6 port (lp_ml::ocr).

    python golden_ocr.py [tiny|small ...] [--no-geometry] [--decoded-only]

Imports service/ocr/ppocr directly (no sidecar) and writes, under
ml-goldens/ocr/:

  geometry.json   the cv2 / pyclipper primitives the pipeline is built on, on
                  seeded random inputs: findContours (RETR_LIST, SIMPLE),
                  get_mini_boxes (minAreaRect + boxPoints + PaddleOCR point
                  order), box_score_fast (fillPoly + masked mean), unclip
                  (pyclipper round offset), order_points_clockwise,
                  rescale_quad, get_rotate_crop_image (getPerspectiveTransform +
                  warpPerspective INTER_CUBIC, BORDER_REPLICATE) and
                  resize_norm_img.
  _decoded/ocr/*.png  cv2's decode of each JPEG (lossless), for the Rust
                  pipeline check on identical pixels.
  pipeline_<tier>.json  per image: the decoded BGR checksum, the detection
                  input size, every detected quad, each crop's recognition
                  (text, confidence) and the engine's predict() / det_only
                  answers.

Images: generated text images (receipt, sign, poster, rotated and vertical
text, 16-bit grey, RGBA, palette, a big page that detection downscales, ...)
under ml-goldens/_images/ocr/, the shared generated images and the fixture's
stills.
"""

import hashlib
import sys

import golden_common as gc

gc.setup("service/ocr")

import cv2  # noqa: E402
import numpy as np  # noqa: E402
from PIL import Image, ImageDraw, ImageFont  # noqa: E402
from ppocr import crop as pcrop  # noqa: E402
from ppocr import detect as pdet  # noqa: E402
from ppocr import recognize as prec  # noqa: E402
from ppocr.engine import PPOCREngine  # noqa: E402

ARGS = [a for a in sys.argv[1:] if not a.startswith("--")]
TIERS = [t for t in ("tiny", "small") if not ARGS or t in ARGS]
OCR_IMAGES = gc.GOLDENS / "_images" / "ocr"


def font(name, size):
    for candidate in (f"C:/Windows/Fonts/{name}", f"/usr/share/fonts/truetype/dejavu/{name}"):
        try:
            return ImageFont.truetype(candidate, size)
        except OSError:
            continue
    return ImageFont.truetype("DejaVuSans.ttf", size)


RECEIPT = [
    "LIBREPHOTOS MARKET",
    "Hauptstrasse 42, 10115 Berlin",
    "Tel. 030 1234567",
    "Date: 2026-09-30  14:22",
    "Receipt #A-1029-XZ",
    "Apples 1.5kg        3.49",
    "Whole milk 1L       1.19",
    "Sourdough bread     4.20",
    "Coffee beans 500g  12.99",
    "Olive oil           8.75",
    "Tomatoes            2.35",
    "Dark chocolate      1.89",
    "Sparkling water x6  3.30",
    "SUBTOTAL           38.16",
    "VAT 7%              2.67",
    "TOTAL EUR          40.83",
    "Card payment       40.83",
    "Thank you for shopping!",
    "www.librephotos.com",
]

POSTER = [
    "Summer Photo Walk",
    "Join us at the old harbour",
    "Saturday, 12 July at 9:30",
    "Bring a camera and good shoes",
    "Free entry for members",
    "Questions? info@example.org",
    "Route: Pier 3 to Lighthouse",
    "Distance 6.5 km",
]

PAGE = [
    "Chapter 3. Organising a photo library",
    "A good library starts with a folder structure",
    "that you can keep for many years. Sort by year,",
    "then by event, and never rename the originals.",
    "Backups belong on two different devices, and",
    "one copy should live outside your home.",
    "Face recognition groups people automatically,",
    "but you still decide who is who.",
    "Search works on places, dates and objects,",
    "and now also on the text inside your photos.",
    "Receipts, signs and screenshots become findable.",
    "Everything runs on your own server.",
    "No cloud account is required at any point.",
    "Page 27",
]


def make_ocr_images():
    OCR_IMAGES.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(20260930)
    specs = {}

    def receipt():
        img = Image.new("RGB", (720, 1100), "white")
        d = ImageDraw.Draw(img)
        f = font("consola.ttf", 28)
        for i, line in enumerate(RECEIPT):
            d.text((40, 40 + i * 54), line, fill="black", font=f)
        return img

    def sign():
        img = Image.new("RGB", (900, 500), (18, 92, 52))
        d = ImageDraw.Draw(img)
        d.rectangle((20, 20, 880, 480), outline="white", width=8)
        d.text((80, 90), "MAIN STREET", fill="white", font=font("arialbd.ttf", 96))
        d.text((80, 260), "Exit 42  Airport", fill="white", font=font("arial.ttf", 72))
        return img

    def poster():
        x = np.linspace(0, 1, 1400, dtype=np.float32)
        y = np.linspace(0, 1, 900, dtype=np.float32)[:, None]
        bg = np.stack(
            [230 - 40 * x + 0 * y, 225 - 30 * y + 0 * x, 200 + 30 * x * y], -1
        ).astype(np.uint8)
        img = Image.fromarray(bg, "RGB")
        d = ImageDraw.Draw(img)
        colors = [(20, 20, 20), (120, 20, 20), (20, 40, 120), (30, 30, 30)]
        for i, line in enumerate(POSTER):
            size = 64 if i == 0 else 44
            d.text((70, 50 + i * 100), line, fill=colors[i % 4], font=font("georgia.ttf", size))
        return img

    def rotated():
        img = Image.new("RGB", (1000, 800), (250, 250, 245))
        for angle, y, text in ((8, 120, "Rotated text line"), (-15, 420, "Tilted receipt 19.99")):
            layer = Image.new("RGBA", (900, 160), (0, 0, 0, 0))
            ImageDraw.Draw(layer).text((20, 40), text, fill=(0, 0, 0, 255), font=font("arial.ttf", 64))
            layer = layer.rotate(angle, resample=Image.BICUBIC, expand=True)
            img.paste(layer, (40, y), layer)
        return img

    def vertical():
        layer = Image.new("RGB", (900, 200), "white")
        ImageDraw.Draw(layer).text((30, 50), "VERTICAL SIGN", fill="black", font=font("arialbd.ttf", 84))
        return layer.rotate(90, expand=True)

    def big():
        img = Image.new("RGB", (2600, 1800), "white")
        d = ImageDraw.Draw(img)
        f = font("arial.ttf", 60)
        for i, line in enumerate(PAGE):
            d.text((120, 60 + i * 120), line, fill=(10, 10, 10), font=f)
        return img

    def document():
        img = Image.new("RGB", (1240, 1754), (252, 252, 250))
        d = ImageDraw.Draw(img)
        f = font("times.ttf", 36)
        for i, line in enumerate(PAGE * 2):
            d.text((100, 80 + i * 58), line, fill=(25, 25, 25), font=f)
        return img

    def gray16():
        img = Image.new("L", (900, 300), 235)
        d = ImageDraw.Draw(img)
        d.text((40, 60), "Grey sixteen bit", fill=20, font=font("arial.ttf", 64))
        d.text((40, 170), "Scan 0042 of 0100", fill=60, font=font("arial.ttf", 56))
        arr = np.asarray(img).astype(np.uint16) * 257 + rng.integers(0, 200, img.size[::-1]).astype(np.uint16)
        return Image.fromarray(arr.astype(np.uint16), "I;16")

    def rgba():
        img = Image.new("RGBA", (900, 300), (40, 60, 200, 90))
        d = ImageDraw.Draw(img)
        d.text((40, 60), "Transparent label", fill=(255, 255, 255, 255), font=font("arialbd.ttf", 64))
        d.text((40, 170), "Alpha channel 50%", fill=(250, 250, 90, 128), font=font("arial.ttf", 56))
        return img

    def palette():
        img = Image.new("RGB", (800, 240), (255, 240, 200))
        d = ImageDraw.Draw(img)
        d.text((30, 70), "Palette PNG 256", fill=(90, 30, 10), font=font("courbd.ttf", 72))
        return img.convert("P", palette=Image.ADAPTIVE, colors=16)

    def small():
        img = Image.new("RGB", (320, 120), "white")
        ImageDraw.Draw(img).text((20, 30), "Hello", fill="black", font=font("arial.ttf", 56))
        return img

    def lowcontrast():
        noise = rng.normal(0, 6, (400, 900, 3))
        base = np.full((400, 900, 3), 205.0) + noise
        img = Image.fromarray(np.clip(base, 0, 255).astype(np.uint8), "RGB")
        d = ImageDraw.Draw(img)
        d.text((40, 60), "Faded label text", fill=(150, 150, 150), font=font("verdana.ttf", 60))
        d.text((40, 220), "Batch 7731-B", fill=(120, 120, 130), font=font("verdana.ttf", 60))
        return img

    def columns():
        img = Image.new("RGB", (1200, 700), "white")
        d = ImageDraw.Draw(img)
        f = font("calibri.ttf", 46)
        left = ["Opening hours", "Monday 9-18", "Tuesday 9-18", "Friday 9-20"]
        right = ["Contact", "Phone 555 0199", "Room 4.12", "Floor 4"]
        for i, (a, b) in enumerate(zip(left, right)):
            d.text((60, 60 + i * 140), a, fill="black", font=f)
            d.text((660, 60 + i * 140), b, fill=(60, 0, 0), font=f)
        return img

    def screenshot():
        img = Image.new("RGB", (1080, 720), (32, 33, 36))
        d = ImageDraw.Draw(img)
        d.rectangle((0, 0, 1080, 90), fill=(60, 64, 67))
        d.text((30, 20), "Settings", fill=(232, 234, 237), font=font("segoeui.ttf", 44))
        items = ["Wi-Fi  Connected", "Bluetooth  Off", "Battery  87%", "Storage  41.2 GB free"]
        for i, t in enumerate(items):
            d.text((40, 140 + i * 130), t, fill=(232, 234, 237), font=font("segoeui.ttf", 48))
        return img

    specs = {
        "receipt_720x1100.png": receipt,
        "sign_900x500.jpg": sign,
        "poster_1400x900.webp": poster,
        "rotated_1000x800.png": rotated,
        "vertical_200x900.png": vertical,
        "big_2600x1800.png": big,
        "document_1240x1754.jpg": document,
        "gray16_900x300.png": gray16,
        "rgba_900x300.png": rgba,
        "palette_800x240.png": palette,
        "small_320x120.png": small,
        "lowcontrast_900x400.png": lowcontrast,
        "columns_1200x700.png": columns,
        "screenshot_1080x720.webp": screenshot,
    }
    out = []
    for name, make in specs.items():
        p = OCR_IMAGES / name
        if not p.exists():
            img = make()
            if p.suffix == ".jpg":
                img.save(p, quality=90)
            elif p.suffix == ".webp":
                img.save(p, quality=88)
            else:
                img.save(p)
        out.append(p)
    return out


def images():
    shared = [p for p in gc.generated_images() if p.suffix.lower() in (".png", ".jpg", ".webp")]
    fixture = [p for p in gc.fixture_images() if p.suffix.lower() in (".jpg", ".jpeg", ".png", ".webp")]
    return make_ocr_images() + shared + fixture


DECODED = gc.GOLDENS / "_decoded" / "ocr"


def decoded_png(path):
    """Where the cv2-decoded pixels of a lossy image are kept (lossless)."""
    return DECODED / (gc.case_id(path).replace("/", "__") + ".png")


def write_decoded():
    """cv2's decode of every JPEG, so the Rust pipeline can be checked on
    exactly the pixels the sidecar saw (its default decoder differs from
    libjpeg-turbo by a few levels)."""
    DECODED.mkdir(parents=True, exist_ok=True)
    for path in images():
        if path.suffix.lower() in (".jpg", ".jpeg"):
            bgr = pdet.read_image(str(path))
            Image.fromarray(np.ascontiguousarray(bgr[:, :, ::-1])).save(decoded_png(path))


def sha(a):
    return hashlib.sha256(np.ascontiguousarray(a).tobytes()).hexdigest()


# --------------------------------------------------------------------------- #
# Geometry primitives
# --------------------------------------------------------------------------- #
def random_bitmap(rng, h, w):
    img = np.zeros((h, w), np.uint8)
    for _ in range(rng.integers(2, 9)):
        kind = rng.integers(0, 4)
        cx, cy = int(rng.integers(0, w)), int(rng.integers(0, h))
        if kind == 0:
            x2, y2 = cx + int(rng.integers(1, w // 2)), cy + int(rng.integers(1, h // 3))
            cv2.rectangle(img, (cx, cy), (x2, y2), 1, -1)
        elif kind == 1:
            axes = (int(rng.integers(1, w // 4)), int(rng.integers(1, h // 4)))
            cv2.ellipse(img, (cx, cy), axes, float(rng.uniform(0, 180)), 0, 360, 1, -1)
        elif kind == 2:
            rect = ((cx, cy), (float(rng.uniform(2, w / 2)), float(rng.uniform(2, h / 3))), float(rng.uniform(-90, 90)))
            cv2.fillPoly(img, [cv2.boxPoints(rect).astype(np.int32)], 1)
        else:
            n = int(rng.integers(3, 30))
            img[rng.integers(0, h, n), rng.integers(0, w, n)] = 1
    # holes
    for _ in range(rng.integers(0, 3)):
        cx, cy = int(rng.integers(0, w)), int(rng.integers(0, h))
        cv2.circle(img, (cx, cy), int(rng.integers(1, 6)), 0, -1)
    return img


def geometry():
    rng = np.random.default_rng(7)
    cases = []

    # findContours + get_mini_boxes on its contours
    for i in range(60):
        h, w = int(rng.integers(8, 120)), int(rng.integers(8, 200))
        bm = random_bitmap(rng, h, w)
        if i % 10 == 0:
            bm[0, :] = 1  # touches the border
        contours, _ = cv2.findContours(bm * 255, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
        minis = []
        for c in contours:
            box, sside = pdet.get_mini_boxes(c)
            rect = cv2.minAreaRect(c)
            minis.append(
                {
                    "box": gc.arr(box),
                    "sside": float(sside),
                    "rect": [float(rect[0][0]), float(rect[0][1]), float(rect[1][0]), float(rect[1][1]), float(rect[2])],
                }
            )
        cases.append(
            gc.case(
                f"contours/{i}",
                {"kind": "contours", "bitmap": gc.arr(bm)},
                {"contours": [gc.arr(c.reshape(-1, 2).astype(np.int32)) for c in contours], "mini": minis},
            )
        )

    # box_score_fast on random maps and quads (incl. ones leaving the map)
    for i in range(80):
        h, w = int(rng.integers(10, 90)), int(rng.integers(10, 140))
        pm = rng.random((h, w), dtype=np.float32)
        cx, cy = rng.uniform(-5, w + 5), rng.uniform(-5, h + 5)
        rect = ((cx, cy), (rng.uniform(1, w), rng.uniform(1, h)), rng.uniform(-90, 90))
        box = cv2.boxPoints(rect).astype(np.float32)
        if i % 4 == 0:
            box = np.round(box)
        cases.append(
            gc.case(
                f"score/{i}",
                {"kind": "score", "prob": gc.arr(pm), "box": gc.arr(box)},
                {"score": pdet.box_score_fast(pm, box)},
            )
        )

    # unclip -> get_mini_boxes -> order_points_clockwise -> rescale_quad
    for i in range(120):
        cx, cy = rng.uniform(0, 400), rng.uniform(0, 300)
        size = (rng.uniform(1, 200), rng.uniform(1, 40))
        angle = 0.0 if i % 3 == 0 else rng.uniform(-90, 90)
        box, _ = pdet.get_mini_boxes(cv2.boxPoints(((cx, cy), size, angle)).reshape(-1, 1, 2).astype(np.float32))
        if i % 5 == 0:
            box = np.floor(box)
        expanded = pdet.unclip(box, 1.4)
        out = {"expanded": None}
        if expanded is not None:
            out["expanded"] = gc.arr(expanded.astype(np.int64))
            if len(expanded) >= 4:
                b2, s2 = pdet.get_mini_boxes(expanded.reshape(-1, 1, 2).astype(np.float32))
                out["mini"] = gc.arr(b2)
                out["sside"] = float(s2)
                ordered = pdet.order_points_clockwise(b2)
                out["ordered"] = gc.arr(ordered)
                dw, dh = int(rng.integers(100, 3000)), int(rng.integers(100, 3000))
                out["dest"] = [dw, dh]
                out["rescaled"] = gc.arr(pdet.rescale_quad(ordered.copy(), (448, 320), (dw, dh)))
        cases.append(
            gc.case(f"unclip/{i}", {"kind": "unclip", "box": gc.arr(box.astype(np.float32))}, out)
        )

    # perspective crops
    for i in range(50):
        h, w = int(rng.integers(20, 120)), int(rng.integers(20, 200))
        img = rng.integers(0, 256, (h, w, 3), dtype=np.uint8)
        img = cv2.GaussianBlur(img, (5, 5), 0)
        cx, cy = rng.uniform(0, w), rng.uniform(0, h)
        rect = ((cx, cy), (rng.uniform(2, w), rng.uniform(2, h / 2)), 0.0 if i % 3 == 0 else rng.uniform(-90, 90))
        box = np.clip(np.round(cv2.boxPoints(rect)), -3, max(w, h) + 3).astype(np.int32)
        box = pdet.order_points_clockwise(box).astype(np.int32)
        if i % 7 == 0:  # tall box -> rot90
            box = np.array([[5, 2], [15, 2], [15, h - 2], [5, h - 2]], np.int32)
        crop = pcrop.get_rotate_crop_image(img, box)
        cases.append(
            gc.case(
                f"crop/{i}",
                {"kind": "crop", "image": gc.arr(img), "box": gc.arr(box)},
                {"crop": gc.arr(np.ascontiguousarray(crop))},
            )
        )

    # recognizer input tensors
    for i in range(30):
        h, w = int(rng.integers(4, 120)), int(rng.integers(4, 900))
        img = cv2.GaussianBlur(rng.integers(0, 256, (h, w, 3), dtype=np.uint8), (3, 3), 0)
        t = prec.resize_norm_img(img, (3, 48, 320))
        cases.append(
            gc.case(f"recnorm/{i}", {"kind": "recnorm", "image": gc.arr(img)}, {"tensor": gc.arr(t)})
        )

    gc.write("ocr", "geometry", cases, meta={"opencv": cv2.__version__})


# --------------------------------------------------------------------------- #
# Full pipeline
# --------------------------------------------------------------------------- #
def pipeline(tier):
    model_dir = gc.data_models() / "ocr" / f"ppocrv6_{tier}"
    engine = PPOCREngine(str(model_dir))
    engine.load()
    cfg = engine.config
    cases = []
    for path in images():
        try:
            image = pdet.read_image(str(path))
        except pdet.OCRDecodeError as e:
            cases.append(gc.case(path, {"image": str(path)}, {"error": str(e)}))
            continue
        h, w = image.shape[:2]
        nh, nw = pdet.compute_resize(h, w, cfg.det_max_side, cfg.det_size_multiple)
        boxes, prob = pdet.detect(engine.det_session, engine.det_input_name, image, cfg, cfg.det_max_side)
        crops = [pcrop.get_rotate_crop_image(image, b) for b in boxes]
        recognized = engine.recognizer.recognize(crops)
        out = {
            "decoded": {"shape": list(image.shape), "sha256": sha(image), "sum": int(image.astype(np.int64).sum())},
            "det_size": [nw, nh],
            "bitmap_sha256": sha((prob > cfg.det_thresh).astype(np.uint8)),
            "prob_sum": float(prob.astype(np.float64).sum()),
            "boxes": [b.tolist() for b in boxes],
            "crops": [{"shape": list(c.shape), "sha256": sha(np.ascontiguousarray(c))} for c in crops],
            "recognized": [[t, float(c)] for t, c in recognized],
            "predict": engine.predict(str(path), min_confidence=0.6),
            "predict_all": engine.predict(str(path), min_confidence=0.0),
            "det_only": engine.predict(str(path), det_only=True),
        }
        if h * w <= 400_000:
            out["prob"] = gc.arr(prob)
        cases.append(gc.case(path, {"image": str(path)}, out))
        print(f"{tier} {path.name}: {len(boxes)} boxes, text={out['predict']['text']!r:.80}")
    gc.write(
        "ocr",
        f"pipeline_{tier}",
        cases,
        meta={"model": f"ppocrv6_{tier}", "opencv": cv2.__version__, "max_side": cfg.det_max_side},
    )


if __name__ == "__main__":
    write_decoded()
    if "--decoded-only" in sys.argv:
        sys.exit(0)
    if "--no-geometry" not in sys.argv:
        geometry()
    for t in TIERS:
        pipeline(t)
