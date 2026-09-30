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

## What the tags goldens established

`golden_tags.py` (both taggers, 82 images: 36 fixture JPEG originals, 37 WebP
big thumbnails, 9 generated edge cases) and
`cargo test -p lp-ml --test tags -- --nocapture`:

- On the same pixels (JPEGs through the Pillow-decoded copies in
  `_decoded/tags/`) both ports give the identical tag list, in the same order,
  on 82/82 images; scores within 4.2e-6 (MobileCLIP probabilities) and 1.6e-7
  (SigLIP 2 cosines), image embeddings at cosine 1.000000.
- Files as they are (our zune-jpeg decoder on the JPEGs): 81/82 (MobileCLIP)
  and 80/82 (SigLIP 2) identical tag sets; the differences are the 10th tag of
  JPEG originals, JPEG score diffs up to 1.1e-2. `tags.generate` feeds the
  WebP big thumbnails, which decode exactly.
- Prompt token ids identical for all 938 prompts plus 12 edge cases, for
  MobileCLIP (`tokenizer.json`) and SigLIP 2 (`tokenizer.model` through the
  pure-Rust sentencepiece BPE encoder in `lp_ml::tags::spm`).
- The tag-embedding cache rebuilt in Rust matches Python's
  `tag_embeddings.npy` (MobileCLIP: min cosine 1.0000000, max diff 4.2e-7;
  SigLIP 2, run with `LP_ML_SLOW_TESTS=1`: min cosine 1.0000000, max diff
  4.2e-7). So a Rust-only install needs no Python to build the caches.

The Python generator must run in UTF-8 mode (it re-executes itself with
`-X utf8`): `siglip2.py` opens `tags.txt` with the locale encoding, which on
Windows garbles "quinceañera". `bench_tags.py` is the Python side of the
`bench_tagger_latency_and_memory` test.

Latency and memory (2026-09-30, release test binary, CPU provider, the 37
fixture WebP thumbnails; the 12-thread box was at 100% load from parallel
agents, so latencies are only roughly comparable):

| Tagger | Model RSS delta Rust / Python | Per photo Rust / Python |
| --- | --- | --- |
| MobileCLIP-S2, 1 intra-op thread, 2 interleaved runs | +177 / +161 MB loaded, +192 / +190 MB after inference | p50 883, 799 ms / 2142, 860 ms |
| MobileCLIP-S2, ORT default threads | +178 / +162 MB, +186 / +191 MB | mean 1064 / 2920 ms |
| SigLIP 2, ORT default threads | +380 / +389 MB, +382 / +499 MB | mean 7385 / 4883 ms |

Base process: Rust 12 MB before loading (40-48 MB after unloading the model),
the Python interpreter with numpy/onnxruntime/PIL 53 MB. The text towers
(MobileCLIP 254 MB, SigLIP 2 1.1 GB) are never resident after the cache exists.

Review round (`golden_tags_edge.py`, written independently of `golden_tags.py`):

- 22 generated inputs per tagger (grey / CMYK / progressive / EXIF-rotated
  JPEG, RGBA / palette+transparency / LA / 16-bit PNG, animated GIF, BMP,
  TIFF, lossless and alpha WebP, 2x3, 90x1600, 257x256, 255x383) plus 4
  fixture thumbnails: identical tags on Pillow's pixels, scores within 5e-6.
  PNG/GIF/BMP/TIFF/WebP files decode to Pillow's exact pixels; JPEGs differ by
  up to 5 levels (CMYK and grey by 1); 16-bit RGB PNG by 1 (rounding vs
  truncation). Neither side applies EXIF orientation (thumbnails are already
  upright).
- Known differences: Pillow turns a 16-bit grey PNG (`I;16`) into solid white
  where we scale it to 8 bits (the caption review's `preprocess::pillow_rgb`
  removes this once merged); a truncated JPEG is a 500 in Python
  ("image file is truncated") but decodes partially here. Empty and non-image
  files fail on both sides.
- `text_fresh.json`: 35 prompts (all non-ASCII tags included) embedded by
  Python's text tower in memory, not read back from the shared cache: Rust
  matches at min cosine 1.0000000, max diff 2.1e-7 (MobileCLIP) and 2.4e-7
  (SigLIP 2).
- SigLIP 2 model time measured alone, interleaved: Rust 4.1 / 2.8 s against
  Python 2.9 / 3.2 s per photo on the loaded box, so the slower SigLIP 2 mean
  above is load noise, not the port.
- Fixed in review: MobileCLIP's shortest-edge resize of an extreme panorama
  (a 10000x1 big thumbnail resizes to 2,560,000x256, about 2 GB) now resamples
  only the centre crop (`pil::resize_crop`, bit-identical to resize-then-crop,
  unit-tested against it); in one process an OOM there would take the whole
  backend down. Python allocates the full image. A corrupt
  `tag_embeddings.npy` or `tokenizer.model` header (huge shape or length) is
  an error instead of an overflow panic while loading. Only an empty model
  name means MobileCLIP, as `tagging_model or DEFAULT` (a padded name is a 400).
