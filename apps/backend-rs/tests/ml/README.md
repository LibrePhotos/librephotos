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

## face_cluster (`golden_face_cluster.py`)

Calls the face_cluster sidecar's routes through Flask's test client (no port)
and writes `cluster.json`, `train.json`, `mlp.json`, `pca.json`, and with
`edge` the `*_edge.json` sets (non-finite encodings, 5k faces, train splits
hard enough that the held-out accuracy is below 1). `timing` writes
`timing.json` (the Python code's wall time on 5k faces). The fixture's
encodings come from `ml-goldens/face_cluster/fixture_faces.psv`
(`id|owner|person|deleted|hex`, exported from a clone of `lp_fixture`).

`cargo test -p lp-ml --test face_cluster -- --nocapture` (loads both sets):

- HDBSCAN (`face_cluster::hdbscan`): identical partitions (adjusted Rand
  index 1.0) on all 20 cases: synthetic identities in 128/512-d, epsilon
  0 / 0.05 / 0.3 / 0.5 / 1.0, `min_samples` 1-5, exact duplicates, all-zero
  inputs, 1.5k and 5k faces, the fixture's faces, rows with NaN / inf
  (noise, as `HDBSCAN.fit` drops them); the same error text for a single
  face and for no finite row. With `min_samples=1` (the default) the labels
  are identical number for number; with larger `min_samples` MST edges tie
  and clusters may be numbered differently (numpy's unstable argsort).
- MLPClassifier (`face_cluster::mlp`): numpy's `RandomState(1)` is
  bit-identical (weights init, epoch shuffles), sklearn's epoch count is hit
  exactly and `predict_proba` differs by at most 2.2e-16. Big products are
  split across rayon without changing a bit (`split_products_are_exact`).
- `/train`: every cluster / classification person identical on 14 cases
  (incl. binary, single-person, no labels, 128-d, 1k known faces, three hard
  splits with held-out accuracy 0.989 / 0.989 / 0.909 in both, NaN / inf
  errors, nothing to predict, the empty error); probabilities within 6.7e-16.
- PCA: the covariance-eigh path (n >= 10 d) within 4e-9; below that sklearn
  uses an unseeded randomized SVD, which the exact result beats in captured
  variance. NaN / inf give sklearn's error text.
- End to end (`cargo test -p lp-tasks --test face_cluster_inprocess`):
  faces.cluster + faces.train in-process on a fixture clone; user-labelled
  faces keep their person. With `LP_FC_SIDECAR_URL` set to a running sidecar
  the same jobs also run through it and must write the same rows.

Throughput (`LP_FC_BENCH=5000,50000 cargo test -p lp-ml --test
face_cluster_bench -- --ignored --nocapture`, debug profile with lp-ml at
opt-level 2, 12 threads, `LP_FC_BENCH_SKIP_HDBSCAN` / `LP_FC_BENCH_TRAIN_MAX`
split a run to stay under 10 minutes), on a box shared with another build:

| | Rust in-process | Python (sklearn / hdbscan) |
| --- | --- | --- |
| HDBSCAN 5k faces | 5.4-6.0 s | 17.7 s |
| HDBSCAN 50k faces | 196 s (core distances 62 s, Prim 134 s), +198 MB over the 195 MB input | ~30 min (n², extrapolated) |
| train 5k (1.4k known / 100 persons, 1.6k rows / 350 classes, 3.6k predicted) | 40-42 s | ~90 s (0.14 s per cluster-classifier epoch) |
| train epoch, 14.3k faces / 1000 classes | 1.4-1.6 s | 3.2 s |
| train epoch, 16.8k rows / 3500 classes | 3.1-3.7 s | 9.0 s |

A 50k-face train needs a few hundred epochs per classifier, so it runs for
tens of minutes either way (not run to the end: benchmarks stay under 10
minutes).

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
- `golden_face.py --edge` (t1.jpg as grey/LA/palette/transparent PNG, CMYK,
  grey and progressive JPEG, EXIF-rotated, 16-bit RGB, TIFF, BMP, GIF, 4096 px,
  plus a 2000x2 sliver, truncated, empty, non-image and missing files): same
  faces and order everywhere, IoU 1.0, cosine >= 0.99926 (JPEGs and 16-bit
  RGB, which `load_rgb` rounds where Pillow truncates; 1.0 on the 8-bit
  lossless ones); the refused inputs are 500s in both. Two known differences:
  a truncated JPEG decodes (partly grey) instead of failing, and a 16-bit grey
  PNG is scaled instead of clipped to white until `load_rgb` converts like
  Pillow.
- Tied detector scores are ordered by numpy 2's SIMD `argsort`, which is not
  stable and depends on the CPU (AVX2/AVX-512/NEON); the port breaks ties by
  descending index. No golden image is affected.
