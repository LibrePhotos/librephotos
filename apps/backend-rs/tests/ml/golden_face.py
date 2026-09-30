"""Goldens for the in-process face service (lp_ml::face).

Drives the real sidecar routes (service/face_recognition/main.py) through
Flask's test client, so /face-locations and /face-encodings answer exactly
as the sidecar does, and records insightface's intermediate values (float
boxes, landmarks, the aligned 112x112 crop) for the Rust port's tests.

Writes face/<model>.json per face pack and face/encodings.json.
"""

import sys
from pathlib import Path

import golden_common as gc

gc.setup("service/face_recognition")

import numpy as np  # noqa: E402
from PIL import Image  # noqa: E402

import main as sidecar  # noqa: E402  (service/face_recognition/main.py)
from insightface.utils import face_align  # noqa: E402

MODELS = [a for a in sys.argv[1:] if not a.startswith("--")] or ["buffalo_sc", "buffalo_l", "buffalo_s", "buffalo_m", "antelopev2"]
# Every image for the default pack and buffalo_l; the rest get a subset.
SUBSET_ONLY = {"buffalo_s", "buffalo_m", "antelopev2"}

APPS = gc.APPS
SITE = Path(np.__file__).resolve().parents[1]


def source_images():
    shots = APPS / "docs" / "static" / "img" / "shots"
    out = [
        SITE / "insightface" / "data" / "images" / "t1.jpg",
        APPS / "backend" / "api" / "tests" / "fixtures" / "niaz.jpg",
        SITE / "skimage" / "data" / "astronaut.png",
        SITE / "skimage" / "data" / "camera.png",
        shots / "faces-light.webp",
        shots / "lightbox-light.webp",
        shots / "places-light.webp",
        shots / "timeline-light.webp",
        shots / "events-dark.webp",
        SITE / "insightface" / "data" / "images" / "Tom_Hanks_54745.png",
    ]
    return [p for p in out if p.exists()]


def derived_images():
    """Variants that hit the other letterbox branch, upscaling, rotation."""
    d = gc.GOLDENS / "_images" / "faces"
    d.mkdir(parents=True, exist_ok=True)
    t1 = SITE / "insightface" / "data" / "images" / "t1.jpg"
    lightbox = APPS / "docs" / "static" / "img" / "shots" / "lightbox-light.webp"
    astronaut = SITE / "skimage" / "data" / "astronaut.png"
    specs = {}
    if t1.exists():
        specs["t1_portrait_500x800.png"] = lambda: Image.open(t1).convert("RGB").crop((300, 40, 800, 840))
        specs["t1_small_320.png"] = lambda: Image.open(t1).convert("RGB").resize((320, 221), Image.BILINEAR)
    if lightbox.exists():
        specs["lightbox_portrait_700x1000.webp"] = lambda: Image.open(lightbox).convert("RGB").crop((450, 0, 1150, 1000))
    if astronaut.exists():
        specs["astronaut_rot90.png"] = lambda: Image.open(astronaut).convert("RGB").transpose(Image.ROTATE_90)
    out = []
    for name, make in specs.items():
        p = d / name
        if not p.exists():
            img = make()
            if p.suffix == ".webp":
                img.save(p, lossless=True)
            else:
                img.save(p)
        out.append(p)
    return out


def edge_images():
    names = {"noise_333x517.jpg", "tiny_1x1.png", "gray_300x200.png", "wide_1600x90.png", "rgba_256x256.png"}
    fixture = [p for p in gc.fixture_images() if p.name == "e2e_01.jpg"][:1]
    return fixture + [p for p in gc.generated_images() if p.name in names]


def post(client, route, body):
    r = client.post(route, json=body)
    return r.status_code, r.get_json()


def e2e(client):
    """Lossy WebP "big thumbnails" with faces for the faces.scan end-to-end
    test (lp-tasks/tests/faces_inprocess.rs), with the sidecar's replies."""
    d = gc.GOLDENS / "face" / "e2e"
    d.mkdir(parents=True, exist_ok=True)
    sources = [p for p in source_images() + derived_images() if p.name != "Tom_Hanks_54745.png"]
    cases = []
    for i, src in enumerate(sources):
        img = Image.open(src).convert("RGB")
        if img.height > 1080:
            img = img.resize((round(img.width * 1080 / img.height), 1080), Image.LANCZOS)
        out = d / f"thumb_{i:02d}.webp"
        img.save(out, quality=90)
        status, reply = post(client, "/face-locations", {"source": str(out), "model_name": "buffalo_sc"})
        assert status == 200, reply
        cases.append(
            gc.case(
                f"e2e/{out.name}",
                {"source": str(out), "from": src.name},
                {
                    "face_locations": [list(loc) for loc in reply["face_locations"]],
                    "encodings": [gc.arr(np.asarray(e, dtype=np.float32)) for e in reply["encodings"]],
                },
            )
        )
    gc.write("face", "e2e", cases, meta={"model": "buffalo_sc"})


def main():
    client = sidecar.app.test_client()
    if "--e2e" in sys.argv:
        e2e(client)
        return
    faces_imgs = source_images() + derived_images()
    all_imgs = faces_imgs + edge_images()
    subset = [p for p in faces_imgs if p.name in {"t1.jpg", "lightbox-light.webp", "t1_portrait_500x800.png"}]
    enc_cases = []
    for model in MODELS:
        fa = sidecar._get_face_analysis(model)
        rec = fa.models["recognition"]
        imgs = subset if model in SUBSET_ONLY else all_imgs
        cases = []
        for path in imgs:
            status, reply = post(client, "/face-locations", {"source": str(path), "model_name": model})
            image = np.array(Image.open(path).convert("RGB"))
            faces = fa.get(image)
            detail = []
            for f in faces:
                crop = face_align.norm_crop(image, landmark=f.kps, image_size=rec.input_size[0])
                detail.append(
                    {
                        "bbox": gc.arr(f.bbox.astype(np.float32)),
                        "det_score": float(f.det_score),
                        "kps": gc.arr(f.kps.astype(np.float32)),
                        "crop": gc.arr(crop),
                        "embedding": gc.arr(f.embedding.astype(np.float32)),
                    }
                )
            assert status == 200, (path, reply)
            cases.append(
                gc.case(
                    path,
                    {"source": str(path), "model_name": model, "size": [image.shape[1], image.shape[0]]},
                    {
                        "face_locations": [list(loc) for loc in reply["face_locations"]],
                        "encodings": [gc.arr(np.asarray(e, dtype=np.float32)) for e in reply["encodings"]],
                        "faces": detail,
                    },
                )
            )
            print(model, len(faces), path.name)
            if model == "buffalo_sc" and reply["face_locations"]:
                locs = [list(loc) for loc in reply["face_locations"]]
                t, r, b, l = locs[0]
                w, h = r - l, b - t
                request = [
                    [t + h // 10, r + w // 8, b - h // 12, l + w // 8],  # a looser hand-drawn box
                    [0, 10, 10, 0],  # nothing there
                    locs[0],  # the same face again: already taken
                ] + locs[1:][::-1]
                status, enc = post(
                    client,
                    "/face-encodings",
                    {"source": str(path), "face_locations": request, "model_name": model},
                )
                assert status == 200, (path, enc)
                enc_cases.append(
                    gc.case(
                        f"{gc.case_id(path)}#encodings",
                        {"source": str(path), "face_locations": request, "model_name": model},
                        {
                            "encodings": [
                                None if e is None else gc.arr(np.asarray(e, dtype=np.float32))
                                for e in enc["encodings"]
                            ]
                        },
                    )
                )
        gc.write("face", model, cases, meta={"model": model, "det_size": [640, 640]})
    if enc_cases:
        gc.write("face", "encodings", enc_cases, meta={"model": "buffalo_sc"})
    # An unknown model name falls back to buffalo_sc; a missing file is a 500.
    status, reply = post(client, "/face-locations", {"source": str(gc.GOLDENS / "missing.jpg"), "model_name": "nope"})
    gc.write("face", "errors", [gc.case("missing", {"status": status}, reply)])


if __name__ == "__main__":
    main()
