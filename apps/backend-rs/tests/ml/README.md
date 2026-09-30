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

## What the face goldens established

`golden_face.py [packs...]` (and `--e2e` for the faces.scan thumbnails) drives
the real sidecar routes through Flask's test client; `cargo test -p lp-ml --test face`
and `cargo test -p lp-tasks --test faces_inprocess`:

- All five packs (buffalo_sc/s/m/l, antelopev2), 132 faces on 20 images:
  same faces in the same order, boxes IoU >= 0.998 (bit-identical float boxes
  on PNG/WebP input; JPEG decoding moves them by < 0.15 px), embeddings
  cosine >= 0.9995 overall and >= 0.999995 on PNG/WebP input. The recogniser
  on Python's own aligned crop is bit-identical.
- Aligned crops differ by at most 1 level on a few pixels: skimage estimates
  the similarity with a float32 SVD, the port in closed form; the warp itself
  is bit-exact to OpenCV 5's float `warpAffine` for a given matrix.
- OpenCV 5.0 changed `warpAffine` (float coordinates, fma lerps); the older
  fixed-point kernel differs by up to 5 levels.
