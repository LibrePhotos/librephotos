# ML goldens

Reference outputs of the Python sidecar code for the in-process ports in
`crates/lp-ml`. A generator imports the sidecar's model code **directly** (it
never starts a sidecar: their ports are fixed and shared machine-wide), runs
it on a list of images and writes JSON the Rust tests compare against.

```bash
PY=/c/Users/Niaz/librephotos/wt-windev/apps/backend/.venv-win/Scripts/python.exe
cd apps/backend-rs/tests/ml
$PY golden_preprocess.py          # resize/tensor/tokenizer goldens for lp_ml::preprocess
$PY golden_<service>.py           # one per ported service (clip, tags, ocr, face, ...)
```

| Path (default) | Env | What |
| --- | --- | --- |
| `<librephotos>/rust-pg/ml` | `LP_ML_ROOT` | `BASE_DATA` for the model code; models in `protected_media/data_models/<model>` (populate with `librephotos-rs models --download --all`) |
| `<librephotos>/rust-pg/ml-goldens/<service>/<name>.json` | `LP_ML_GOLDENS` | the goldens |
| `<librephotos>/rust-pg/ml-goldens/_images/` | | generated edge-case images (gradient, noise JPEG, grey, RGBA, 1x1, very wide, checkerboard, text) + insightface's sample faces |
| `<librephotos>/rust-pg/fixture` | `LP_FIXTURE_ROOT` | the fixture's photos and thumbnails |

## Writing a generator

```python
import golden_common as gc
gc.setup("service/clip_embeddings")        # env + sys.path, BEFORE sidecar imports
from clip_onnx import ClipEmbeddings

clip = ClipEmbeddings()
model = str(gc.data_models() / "clip_vit_b32")
cases = []
for path in gc.default_images():
    (emb,) = clip.encode_images([str(path)], model)
    cases.append(gc.case(path, {"image": str(path)},
                         {"embedding": None if emb is None else gc.arr(emb)}))
gc.write("clip", "images", cases, meta={"model": "clip_vit_b32"})
```

Format: `{"service", "name", "meta", "cases": [{"id", "input", "output"}]}`;
arrays are `{"dtype", "shape", "b64"}` (little-endian bytes, `gc.arr`).
`gc.setup` forces `ONNX_PROVIDERS=CPUExecutionProvider` unless set.

## Rust side (`lp_ml::golden`)

```rust
let Some(g) = lp_ml::golden::load("clip", "images") else { return };  // skip without goldens
for c in &g.cases {
    let want = golden::Array::from_json(&c.output["embedding"]).f32();
    golden::assert_cosine(&ours, &want, 0.999, &c.id);
}
```

Helpers: `root()`, `ml_root()`, `data_models()`, `Array::{from_json, u8, f32, i64}`,
`floats`, `cosine`, `assert_cosine`, `max_abs_diff`, `u8_diff`, `iou` (x1,y1,x2,y2),
`iou_trbl` (the sidecars' top,right,bottom,left). Tests that need ONNX Runtime
also skip without `LP_ORT_LIB`.

## What the preprocess goldens established

`cargo test -p lp-ml --test preprocess_goldens -- --nocapture`:

- `lp_ml::preprocess::pil::resize` (BICUBIC, BILINEAR, LANCZOS, and the CLIP /
  MobileCLIP shortest-edge + centre-crop helper) is **bit-identical** to
  Pillow 12 on all 28 images; the CLIP tensor (`to_chw`) is bit-identical too.
- `preprocess::cv2::resize_linear` is identical to `cv2.resize` for downscales
  (incl. the exact-2x `INTER_AREA` shortcut) and within 1 level on upscales;
  `resize_area` within 1 level.
- Decoding (`preprocess::load_rgb`): PNG and WebP identical to Pillow; JPEG
  differs by up to 8 levels (zune-jpeg vs libjpeg-turbo). The big thumbnails
  most models read are WebP. For exact JPEG, install a libjpeg-turbo decoder
  with `preprocess::set_decoder` (e.g. through libvips).
- HF `tokenizers` ids identical for every `tokenizer.json` (CLIP, MobileCLIP,
  LFM2). SigLIP 2 ships a sentencepiece `tokenizer.model`, which the
  `tokenizers` crate cannot read directly.

## What the OCR goldens established

`python golden_ocr.py` (geometry + `pipeline_tiny` + `pipeline_small`, and
cv2's decode of every JPEG under `_decoded/ocr/`), then
`cargo test -p lp-ml --test ocr -- --nocapture` (`--ignored` adds the ~7 min
small tier). The reference is opencv-python 5.0.0 + pyclipper 1.4.0 (Clipper
6.4.2), numpy 2:

- The DB-postprocess and crop primitives are ported from the OpenCV 5 /
  Clipper sources and are **bit-exact** on 340 seeded random cases:
  `findContours` (60 bitmaps, points and contour order), `minAreaRect` +
  `boxPoints` + PaddleOCR's point order (1113 boxes), `fillPoly` +
  masked mean (80 scores), the round-join `unclip` (120 polygons, incl.
  Clipper's union order), `getPerspectiveTransform` + `warpPerspective`
  `INTER_CUBIC` (50 crops, OpenCV 5's table-free FMA kernel). The recognizer
  tensor (`cv2.resize` upscale) is within one level.
- On identical pixels (58 PNG/WebP files + cv2's decode of 38 JPEGs), both
  tiers: every detected quad identical (tiny 305/305, small 199/199), every
  crop identical, every recognized line identical (tiny 121/121, small
  107/107), whole answers identical (tiny 95/96: one block's confidence off
  by 0.018 through the resize, text the same; small 96/96). Probability maps
  within 1.4e-3.
- JPEG files through the default decoder (zune-jpeg, a few levels off
  libjpeg-turbo): lines identical tiny 33/34, small 23/23. cv2, Pillow and
  libvips decode all 33 fixture JPEGs identically, so a libvips/libjpeg-turbo
  `preprocess::set_decoder` makes JPEGs exact too.
