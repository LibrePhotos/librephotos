"""Shared helpers for the ML golden generators (golden_<service>.py).

The generators import the Python sidecar / model code DIRECTLY (never start a
sidecar server: their ports are fixed and shared machine-wide), run it on a
list of images, and write the reference outputs the Rust in-process ports are
tested against (``lp_ml::golden`` loads them).

Layout (defaults, all overridable by env):

    <librephotos>/rust-pg/ml                  LP_ML_ROOT: BASE_DATA of the sidecar code;
                                              models in protected_media/data_models/<model>
    <librephotos>/rust-pg/ml-goldens          LP_ML_GOLDENS: <service>/<name>.json
    <librephotos>/rust-pg/ml-goldens/_images  generated test images
    <librephotos>/rust-pg/fixture             LP_FIXTURE_ROOT: the fixture's photos

Usage in a generator::

    import golden_common as gc
    gc.setup("service/clip_embeddings")   # BEFORE importing sidecar modules
    from clip_onnx import ClipEmbeddings
    cases = [gc.case(p, {"image": str(p)}, {"embedding": gc.arr(e)}) for ...]
    gc.write("clip", "images", cases, meta={"model": "clip_vit_b32"})

JSON layout: ``{"service", "name", "meta", "cases": [{"id", "input", "output"}]}``;
arrays are ``{"dtype", "shape", "b64"}`` (little-endian raw bytes, see ``arr``).
Run with the Django venv's python (onnxruntime, insightface, cv2, PIL, ...).
"""

import base64
import datetime
import json
import os
import platform
import sys
from pathlib import Path
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "bench"))
import no_console  # noqa: F401,E402  (no console windows on Windows)

HERE = Path(__file__).resolve().parent
# tests/ml -> tests -> backend-rs -> apps -> <worktree> -> <librephotos>
APPS = HERE.parents[2]
BACKEND = APPS / "backend"
LIBREPHOTOS = HERE.parents[4]
RUST_PG = Path(os.environ.get("LP_RUST_PG", LIBREPHOTOS / "rust-pg"))
ML_ROOT = Path(os.environ.get("LP_ML_ROOT", RUST_PG / "ml"))
GOLDENS = Path(os.environ.get("LP_ML_GOLDENS", RUST_PG / "ml-goldens"))
FIXTURE = Path(os.environ.get("LP_FIXTURE_ROOT", RUST_PG / "fixture"))

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".gif"}


def setup(*service_dirs):
    """Environment and sys.path as api.services gives a sidecar.

    Call before importing any sidecar module: they read BASE_DATA at import
    time. ``service_dirs`` (relative to apps/backend, e.g.
    ``"service/clip_embeddings"``) go first on sys.path, as a script's own
    directory does when it runs as ``python service/<name>/main.py``.
    """
    os.environ["BASE_DATA"] = str(ML_ROOT)
    os.environ.setdefault("ONNX_PROVIDERS", "CPUExecutionProvider")
    for d in reversed(service_dirs):
        sys.path.insert(0, str(BACKEND / d))
    if str(BACKEND) not in sys.path:
        sys.path.insert(len(service_dirs), str(BACKEND))


def data_models():
    return ML_ROOT / "protected_media" / "data_models"


def fixture_images(limit=None):
    """The fixture's decodable stills (originals, then big thumbnails)."""
    out = []
    data = FIXTURE / "data"
    if data.is_dir():
        out += sorted(
            p for p in data.rglob("*") if p.is_file() and p.suffix.lower() in IMAGE_EXTS
        )
    thumbs = FIXTURE / "protected_media" / "thumbnails_big"
    if thumbs.is_dir():
        out += sorted(p for p in thumbs.iterdir() if p.suffix.lower() == ".webp")
    return out[:limit] if limit else out


def generated_images():
    """Deterministic synthetic images covering the edge cases (created once)."""
    import numpy as np
    from PIL import Image, ImageDraw, ImageFont

    d = GOLDENS / "_images"
    d.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(20260930)
    specs = {}

    def gradient(w, h):
        x = np.linspace(0, 255, w, dtype=np.float32)
        y = np.linspace(0, 255, h, dtype=np.float32)
        r = np.tile(x, (h, 1))
        g = np.tile(y[:, None], (1, w))
        b = (r + g) / 2
        return Image.fromarray(np.stack([r, g, b], -1).astype(np.uint8), "RGB")

    specs["gradient_640x480.png"] = lambda: gradient(640, 480)
    specs["noise_333x517.jpg"] = lambda: Image.fromarray(
        rng.integers(0, 256, (517, 333, 3), dtype=np.uint8), "RGB"
    )
    specs["gray_300x200.png"] = lambda: gradient(300, 200).convert("L")
    specs["rgba_256x256.png"] = lambda: gradient(256, 256).convert("RGBA")
    specs["tiny_1x1.png"] = lambda: Image.new("RGB", (1, 1), (200, 100, 50))
    specs["wide_1600x90.png"] = lambda: gradient(1600, 90)
    specs["checker_1024x768.jpg"] = lambda: Image.fromarray(
        (((np.indices((768, 1024)).sum(0) // 16) % 2) * 255)
        .astype(np.uint8)
        .repeat(3)
        .reshape(768, 1024, 3),
        "RGB",
    )

    def text():
        img = Image.new("RGB", (900, 260), "white")
        draw = ImageDraw.Draw(img)
        try:
            font = ImageFont.truetype("arial.ttf", 44)
        except OSError:
            font = ImageFont.load_default()
        draw.text((30, 40), "LibrePhotos 2026", fill="black", font=font)
        draw.text((30, 140), "Receipt total: 42.50 EUR", fill=(20, 20, 120), font=font)
        return img

    specs["text_900x260.png"] = text

    out = []
    for name, make in specs.items():
        p = d / name
        if not p.exists():
            img = make()
            if p.suffix == ".jpg":
                img.save(p, quality=90)
            else:
                img.save(p)
        out.append(p)
    # insightface's sample faces, for the face goldens.
    try:
        import insightface

        faces = Path(insightface.__file__).parent / "data" / "images"
        for n in ("t1.jpg", "Tom_Hanks_54745.png"):
            if (faces / n).exists():
                out.append(faces / n)
    except ImportError:
        pass
    return out


def default_images(fixture_limit=None):
    return fixture_images(fixture_limit) + generated_images()


def case_id(path):
    """A stable id: the path relative to the fixture / goldens / its dir."""
    p = Path(path)
    for root in (FIXTURE, GOLDENS):
        try:
            return p.relative_to(root).as_posix()
        except ValueError:
            pass
    return p.name


def arr(a):
    """A numpy array as ``{"dtype", "shape", "b64"}`` (little-endian)."""
    import numpy as np

    a = np.ascontiguousarray(a)
    le = a.astype(a.dtype.newbyteorder("<"), copy=False)
    return {
        "dtype": str(a.dtype),
        "shape": list(a.shape),
        "b64": base64.b64encode(le.tobytes()).decode("ascii"),
    }


def case(case_id_or_path, input, output):
    cid = case_id(case_id_or_path) if isinstance(case_id_or_path, Path) else str(case_id_or_path)
    return {"id": cid, "input": input, "output": output}


def _versions():
    v = {"python": platform.python_version()}
    for mod in ("numpy", "onnxruntime", "PIL", "cv2", "tokenizers", "insightface"):
        try:
            m = __import__(mod)
            v[mod] = getattr(m, "__version__", "?")
        except ImportError:
            pass
    return v


def write(service, name, cases, meta=None):
    out = GOLDENS / service / f"{name}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    doc = {
        "service": service,
        "name": name,
        "meta": {
            "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "generator": Path(sys.argv[0]).name,
            "ml_root": str(ML_ROOT),
            "versions": _versions(),
            **(meta or {}),
        },
        "cases": cases,
    }
    tmp = out.with_suffix(".json.part")
    tmp.write_text(json.dumps(doc), encoding="utf-8")
    os.replace(tmp, out)
    print(f"wrote {out} ({len(cases)} cases, {out.stat().st_size / 1e6:.1f} MB)")
    return out
