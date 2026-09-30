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

## CLIP and the similarity index (`golden_clip.py`, `golden_similarity.py`)

`cargo test -p lp-ml --test clip --test similarity -- --nocapture`
(`LP_ORT_LIB` set), and end to end `cargo test -p lp-tasks --test clip_inprocess`:

- Text embeddings (9 queries incl. empty, non-Latin and > 77 tokens): token
  ids identical, embeddings bit-identical (cosine 1.0, max abs diff 0).
- Image embeddings over 82 images + a missing path (one `encode_images`
  call, batches of 32, `None` slot kept): WebP and PNG bit-identical
  (cosine 1.0); JPEG min cosine 0.99953 (zune-jpeg vs libjpeg-turbo, see
  above). `clip.embed` reads the WebP big thumbnails, so stored embeddings
  equal the sidecar's (31/31 on the fixture).
- The index's inner product reproduces FAISS 1.15's AVX2
  `fvec_inner_product` bit for bit (8 f32 lanes, mul then add, halving
  reduction): 10,200 top-100 distances identical, and all 444 searches
  (thresholds 0/20/27/90, n 3..100, exact-duplicate ties) return the same
  hashes in the same order as `RetrievalIndex.search_similar`. A plain f32
  or f64 dot product swaps near-equal neighbours (1 ulp apart).
- Edge images (`clip/edge.json`: 66 files from the shared `tags_edge`,
  `caption_edge`, `faces_edge` sets plus `clip_edge`: cut JPEG/PNG, trailing
  junk, zero bytes, text named .png, 16-bit RGB/RGBA/grey, 6000x4000):
  the same 10 are unreadable as for Pillow (`None` slot); the rest are
  within cosine 0.998 (PNG incl. 16-bit and palette, BMP, TIFF, GIF, WebP:
  1.0; JPEG min 0.99823 on a 96x64 JPEG upscaled 3.5x, EXIF-rotated and
  progressive >= 0.9990, CMYK >= 0.9999). `preprocess::load_rgb` follows Pillow here through
  `open_pillow` (a JPEG without EOI is "truncated", a PNG cut in `IEND`
  opens) and `pillow_rgb8` (16-bit colour keeps the high byte, 16-bit grey
  clips at 255 like mode `I;16`). `preprocess::open` stays lenient.
- `similarity.build` reads the embeddings page by page (keyset on
  `image_hash, id`, 5000 per page, `clip_embeddings::text` parsed straight
  to f32), so a rebuild holds one page in memory, not every embedding as
  JSON values; rebuilds are serialized per process. Index files are
  streamed in and out (no second copy in memory), and the startup check
  also validates the hash list, so a torn or damaged file is rebuilt.
