import argparse
import hashlib
import io
import os
import shutil
import statistics
import sys
import tarfile
import time
import urllib.request
import zipfile
from collections.abc import Callable
from pathlib import Path

import numpy as np
import numpy.typing as npt

BACKEND = Path(__file__).resolve().parents[1]
REPO = BACKEND.parents[1]
sys.path.insert(0, str(BACKEND))

JPEGS = [
    *sorted((REPO / "deploy" / "e2e" / "photos").glob("*.jpg")),
    BACKEND / "api" / "tests" / "fixtures" / "iptc_test.jpg",
    BACKEND / "api" / "tests" / "fixtures" / "niaz.jpg",
    REPO / "apps" / "frontend" / "public" / "login_background.jpg",
]
MODELS = {"buffalo_sc": "face", "ppocrv6_tiny": "ocr"}
BIG_SIZE = (4000, 6000)
EVERY_STAGE = {
    "geometry": {
        "straighten": 4,
        "orientation": 90,
        "crop": {"cx": 0.48, "cy": 0.52, "w": 0.8, "h": 0.7},
    },
    "wb": {"temp": 20, "tint": -10},
    "light": {
        "exposure": 0.4,
        "contrast": 20,
        "highlights": -40,
        "shadows": 35,
        "whites": 10,
        "blacks": -10,
    },
    "curve": {"master": [[0, 0], [0.4, 0.45], [1, 1]], "blue": [[0, 0.05], [1, 1]]},
    "color": {"vibrance": 25, "saturation": 10},
    "mixer": {"red": {"hue": 20, "sat": 10, "lum": -10}},
    "grading": {"shadows": {"hue": 220, "sat": 30}, "global": {"lum": 10}},
    "effects": {"texture": 30, "clarity": 40, "dehaze": 25},
    "vignette": {"amount": -30, "roundness": 20},
    "grain": {"amount": 25, "seed": 9},
    "detail": {"sharpen_amount": 60, "nr_luminance": 30, "nr_color": 40},
}

type Arrays = dict[str, npt.NDArray[np.generic]]


def big_picture() -> npt.NDArray[np.uint8]:
    rng = np.random.default_rng(7)
    height, width = BIG_SIZE
    coarse = rng.integers(20, 235, (height // 250, width // 250, 3)).astype(np.float32)
    rows = np.linspace(0, coarse.shape[0] - 1, height)
    cols = np.linspace(0, coarse.shape[1] - 1, width)
    r0 = np.floor(rows).astype(int)
    c0 = np.floor(cols).astype(int)
    r1 = np.minimum(r0 + 1, coarse.shape[0] - 1)
    c1 = np.minimum(c0 + 1, coarse.shape[1] - 1)
    fr = (rows - r0)[:, None, None]
    fc = (cols - c0)[None, :, None]
    top = coarse[r0][:, c0] * (1 - fc) + coarse[r0][:, c1] * fc
    bottom = coarse[r1][:, c0] * (1 - fc) + coarse[r1][:, c1] * fc
    smooth = top * (1 - fr) + bottom * fr
    noise = rng.normal(0, 4, (height, width, 1)).astype(np.float32)
    return np.clip(smooth + noise, 0, 255).astype(np.uint8)


def prepare(out: Path) -> None:
    import PIL.Image
    import pyvips

    out.mkdir(parents=True, exist_ok=True)
    for path in JPEGS:
        shutil.copy2(path, out / path.name)
    base = PIL.Image.open(JPEGS[0]).convert("RGB")
    base.save(out / "rgb.png")
    base.convert("RGBA").save(out / "rgba.png")
    base.convert("L").save(out / "gray.png")
    base.convert("LA").save(out / "gray_alpha.png")
    base.convert("P").save(out / "palette.png")
    base.convert("I;16").save(out / "gray16.png")
    vips = pyvips.Image.new_from_file(str(JPEGS[0]))
    (vips.cast("ushort") * 257).cast("ushort").copy(interpretation="rgb16").pngsave(
        str(out / "rgb16.png")
    )
    base.save(out / "lzw.tif", compression="tiff_lzw")
    base.save(out / "deflate.tif", compression="tiff_adobe_deflate")
    base.save(out / "lossy.webp", quality=80)
    base.save(out / "lossless.webp", lossless=True)
    base.convert("RGBA").save(out / "rgba.webp", quality=80)
    base.save(out / "rgb.bmp")
    base.convert("CMYK").save(out / "cmyk.jpg", quality=90)
    base.convert("L").save(out / "gray.jpg", quality=90)
    base.save(out / "progressive.jpg", quality=90, progressive=True)
    np.save(out / "big.npy", big_picture())


def setup_django() -> None:
    import django

    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "librephotos.settings.test_sqlite")
    os.environ.setdefault("ONNX_PROVIDERS", "CPUExecutionProvider")
    django.setup()


def fetch_models(out: Path) -> None:
    setup_django()
    from api.runtime.ml_models import ML_MODELS

    for entry in ML_MODELS:
        if entry["name"] not in MODELS:
            continue
        target = out / MODELS[str(entry["name"])]
        if target.exists():
            continue
        url = str(entry["url"])
        print("downloading", url, flush=True)
        request = urllib.request.Request(url, headers={"User-Agent": "python-urllib"})
        with urllib.request.urlopen(request, timeout=600) as response:
            data = response.read()
        if hashlib.sha256(data).hexdigest() != entry["sha256"]:
            sys.exit(f"{entry['name']}: checksum mismatch")
        target.mkdir(parents=True)
        if url.partition("?")[0].endswith(".zip"):
            zipfile.ZipFile(io.BytesIO(data)).extractall(target)
        else:
            tarfile.open(fileobj=io.BytesIO(data)).extractall(target, filter="data")


def model_dir(models: Path, kind: str, marker: str) -> str:
    return str(next((models / kind).rglob(marker)).parent)


def timed(task: Callable[[], object], runs: int = 5) -> float:
    durations = []
    for _ in range(runs):
        start = time.perf_counter()
        task()
        durations.append((time.perf_counter() - start) * 1000)
    return statistics.median(durations)


def landmarks_for(
    image: npt.NDArray[np.uint8], seed: int
) -> list[npt.NDArray[np.float32]]:
    from service.face_recognition.face_analysis import ARCFACE_DST

    rng = np.random.default_rng(seed)
    height, width = image.shape[:2]
    out = []
    for _ in range(20):
        scale = rng.uniform(0.3, 3.0)
        angle = rng.uniform(-0.6, 0.6)
        rotation = np.array(
            [[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]]
        )
        centre = rng.uniform([0, 0], [width, height])
        points = (ARCFACE_DST - 56.0) @ rotation.T * scale + centre
        out.append(points.astype(np.float32))
    return out


def dump_face(inputs: Path, models: Path | None, arrays: Arrays) -> None:
    import cv2
    import PIL.Image

    from service.face_recognition import face_analysis

    analysis = None
    captured: list[npt.NDArray[np.uint8]] = []
    if models is not None:
        analysis = face_analysis.FaceAnalysis(model_dir(models, "face", "*.onnx"))
        original = face_analysis.blob_from_images

        def capture(
            images: list[npt.NDArray[np.uint8]], scale: float, mean: float
        ) -> npt.NDArray[np.float32]:
            captured.extend(images)
            return original(images, scale, mean)

        face_analysis.blob_from_images = capture
    for index, path in enumerate(JPEGS):
        image = np.asarray(PIL.Image.open(inputs / path.name).convert("RGB"))
        for number, points in enumerate(landmarks_for(image, index)):
            arrays[f"face/norm_crop/{path.name}/{number}"] = face_analysis.norm_crop(
                image, points
            )
        arrays[f"face/resize640/{path.name}"] = cv2.resize(
            image, (640, int(640 * image.shape[0] / image.shape[1]))
        )
        if analysis is None:
            continue
        captured.clear()
        faces = analysis.get(image)
        for number, blob_input in enumerate(captured):
            arrays[f"face/model_input/{path.name}/{number}"] = blob_input
        for number, face in enumerate(faces):
            arrays[f"face/bbox/{path.name}/{number}"] = np.asarray(face.bbox)
            arrays[f"face/kps/{path.name}/{number}"] = np.asarray(face.kps)
            arrays[f"embedding/{path.name}/{number}"] = np.asarray(face.embedding)
        for number, points in enumerate(landmarks_for(image, index)[:5]):
            arrays[f"embedding/{path.name}/random{number}"] = (
                analysis.recognizer.embedding(image, points)
            )


def ocr_inputs(inputs: Path) -> list[Path]:
    return sorted(p for p in inputs.iterdir() if p.suffix != ".npy")


def dump_ocr(inputs: Path, models: Path | None, arrays: Arrays) -> None:
    from service.ocr.ppocr.crop import get_rotate_crop_image
    from service.ocr.ppocr.detect import detect, read_image
    from service.ocr.ppocr.engine import PPOCREngine
    from service.ocr.ppocr.recognize import resize_norm_img

    engine = None
    if models is not None:
        engine = PPOCREngine(model_dir(models, "ocr", "config.json"))
        engine.load()
    for path in ocr_inputs(inputs):
        image = read_image(str(path))
        arrays[f"ocr/read/{path.name}"] = image
        if engine is None or engine.config is None or engine.det_input_name is None:
            continue
        boxes, prob_map = detect(
            engine.det_session,
            engine.det_input_name,
            image,
            engine.config,
            engine.config.det_max_side,
        )
        arrays[f"ocr/prob_map/{path.name}"] = prob_map
        arrays[f"ocr/boxes/{path.name}"] = np.asarray(boxes, dtype=np.int32).reshape(
            -1, 4, 2
        )
        for number, box in enumerate(boxes[:40]):
            crop = get_rotate_crop_image(image, box)
            arrays[f"ocr/crop/{path.name}/{number}"] = crop
            arrays[f"ocr/rec_input/{path.name}/{number}"] = resize_norm_img(
                crop, engine.config.rec_input_shape
            )
        result = engine.predict(str(path))
        text = str(result.get("text", ""))
        arrays[f"ocr/text/{path.name}"] = np.frombuffer(
            text.encode("utf-8"), dtype=np.uint8
        )


def dump_editor(inputs: Path, arrays: Arrays) -> None:
    from api.editing.pipeline import render
    from api.editing.recipe import recipe_from_json
    from api.editing.source import Source, load_source

    recipe = recipe_from_json(EVERY_STAGE)
    for path in JPEGS:
        source = load_source(str(inputs / path.name), 1, long_edge=1500)
        arrays[f"editor/source/{path.name}"] = source.pixels
        arrays[f"editor/render/{path.name}"] = render(source, recipe, long_edge=1024)
    full = load_source(str(inputs / JPEGS[-1].name), 1)
    arrays["editor/render_full/srgb8"] = render(full, recipe)
    linear = (full.pixels.astype(np.uint16) * 257).astype(np.uint16)
    linear16 = Source(linear, "linear16", 4.0, linear.shape[1], linear.shape[0])
    arrays["editor/render_full/linear16"] = render(linear16, recipe)
    arrays["editor/render_small/linear16"] = render(linear16, recipe, long_edge=800)


def dump_timing(inputs: Path, arrays: Arrays) -> None:
    import cv2

    from api.editing.pipeline import render
    from api.editing.recipe import recipe_from_json
    from api.editing.source import Source

    big = np.load(inputs / "big.npy")
    big16 = (big.astype(np.uint16) * 257).astype(np.uint16)
    height, width = big.shape[:2]
    angle = np.deg2rad(4.0)
    matrix = np.array(
        [
            [np.cos(angle), -np.sin(angle), 120.0],
            [np.sin(angle), np.cos(angle), -80.0],
        ]
    )
    plane = np.ascontiguousarray(big[:1024, :1536, 0].astype(np.float32) / 255)
    values = np.ascontiguousarray(big[:2000, :2000].reshape(-1).astype(np.float32) / 64)
    flags = cv2.INTER_LINEAR | cv2.WARP_INVERSE_MAP
    tasks: dict[str, Callable[[], object]] = {
        "resize_area_u8_24mp": lambda: cv2.resize(
            big, (2200, 1467), interpolation=cv2.INTER_AREA
        ),
        "resize_area_u16_24mp": lambda: cv2.resize(
            big16, (2200, 1467), interpolation=cv2.INTER_AREA
        ),
        "resize_linear_u8_24mp": lambda: cv2.resize(big, (640, 427)),
        "warp_affine_u8_24mp": lambda: cv2.warpAffine(
            big, matrix, (width, height), flags=flags, borderMode=cv2.BORDER_REPLICATE
        ),
        "warp_affine_u16_24mp": lambda: cv2.warpAffine(
            big16, matrix, (width, height), flags=flags, borderMode=cv2.BORDER_REPLICATE
        ),
        "gaussian_blur_1024": lambda: cv2.GaussianBlur(
            plane, (0, 0), 4.1, borderType=cv2.BORDER_REPLICATE
        ),
        "exp_4mp": lambda: cv2.exp(values),
        "cart_to_polar_4mp": lambda: cv2.cartToPolar(
            values, values, angleInDegrees=True
        ),
    }
    for name, task in tasks.items():
        arrays[f"time/{name}"] = np.array(timed(task))
    source = Source(big, "srgb8", 1.0, width, height)
    recipe = recipe_from_json(EVERY_STAGE)
    arrays["time/render_24mp"] = np.array(timed(lambda: render(source, recipe), 3))


def dump(inputs: Path, out: Path, models: Path | None, timing: bool) -> None:
    setup_django()
    import cv2

    print("cv2", cv2.__version__, cv2.__file__, flush=True)
    arrays: Arrays = {}
    dump_face(inputs, models, arrays)
    dump_ocr(inputs, models, arrays)
    dump_editor(inputs, arrays)
    if timing:
        dump_timing(inputs, arrays)
    np.savez_compressed(out, **arrays)
    print(f"{len(arrays)} arrays written to {out}")


def cosine(a: npt.NDArray[np.floating], b: npt.NDArray[np.floating]) -> float:
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


def compare(first: Path, second: Path) -> int:
    a = np.load(first)
    b = np.load(second)
    failures = []
    if set(a.files) != set(b.files):
        failures.append(f"different keys: {sorted(set(a.files) ^ set(b.files))}")
    groups: dict[str, list[float]] = {}
    for key in sorted(set(a.files) & set(b.files)):
        x, y = a[key], b[key]
        group = "/".join(key.split("/")[:2])
        if key.startswith("time/"):
            print(
                f"{key:40} {float(x):10.1f} ms {float(y):10.1f} ms  x{float(y) / float(x):.2f}"
            )
            continue
        if x.shape != y.shape or x.dtype != y.dtype:
            failures.append(f"{key}: {x.dtype}{x.shape} != {y.dtype}{y.shape}")
            continue
        diff = (
            float(np.abs(x.astype(np.float64) - y.astype(np.float64)).max())
            if x.size
            else 0.0
        )
        groups.setdefault(group, []).append(diff)
        if key.startswith("embedding/"):
            print(f"{key:40} cosine {cosine(x, y):.9f} max diff {diff:g}")
        if diff:
            failures.append(f"{key}: max abs diff {diff:g}")
    for group, diffs in groups.items():
        print(f"{group:40} {len(diffs):5} arrays, max abs diff {max(diffs):g}")
    for failure in failures:
        print("DIFF", failure)
    return 1 if failures else 0


def main() -> None:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    prepare_parser = commands.add_parser("prepare")
    prepare_parser.add_argument("inputs", type=Path)
    models_parser = commands.add_parser("models")
    models_parser.add_argument("models", type=Path)
    dump_parser = commands.add_parser("dump")
    dump_parser.add_argument("inputs", type=Path)
    dump_parser.add_argument("out", type=Path)
    dump_parser.add_argument("--models", type=Path)
    dump_parser.add_argument("--timing", action="store_true")
    compare_parser = commands.add_parser("compare")
    compare_parser.add_argument("first", type=Path)
    compare_parser.add_argument("second", type=Path)
    args = parser.parse_args()
    if args.command == "prepare":
        prepare(args.inputs)
    elif args.command == "models":
        fetch_models(args.models)
    elif args.command == "dump":
        dump(args.inputs, args.out, args.models, args.timing)
    else:
        sys.exit(compare(args.first, args.second))


if __name__ == "__main__":
    main()
