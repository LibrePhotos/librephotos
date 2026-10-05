# Optimization ledger (RAM vs speed)

One row per experiment, protocol in `rust-pg/workflows/opt_protocol.md`: baseline and
variant from the same binary (env switch), alternating B/V, medians with every run in
brackets. Machine: Ryzen 5 2600X, 32 GB, Windows 11, Postgres 16 on the same box.

Benchmarks used:

- **ML-on scan**: `ml_footprint.py [--env K=V] scan rs` (290 photos, whole tree pinned to
  4 cores, 1 worker, ONNX_INTRA_OP_THREADS=4): scan + tags + CLIP + faces, face training,
  OCR full scan (ppocrv6_small), 10 captions. Peak = working set of the process tree.
- **Per model**: `ml_footprint.py [--env K=V] models --only <service>` (fresh process,
  6 photos, one service): RSS after the service ran, and the peak.
- **W4 scan**: `w4.py scan --variants rust,rust@v --variant-env v:K=V` (2,025 generated
  files incl. 5 videos, ML off, server on 6 CPUs, 6 workers), with `--idle-wait 75`
  (tree memory 75 s after the rescan) and `--dump-phash`; per-executable peaks via psutil.
- **Serving**: `quick.py --contenders rust --endpoints media_square_small,media_big`.

| # | change | metric(s) | baseline (median, spread) | variant (median, spread) | delta | kept? | commit |
|---|---|---|---|---|---|---|---|
| 1 | ONNX Runtime CPU arena: one shared environment arena, `kSameAsRequested`, shrunk after each run (`LP_ORT_CPU_ARENA=shared`, now default; `1` = old per-session arena, `0` = none, `shrink` = per-session + shrink) | ML-on scan: peak RSS / peak private / RSS after captions (MB); scan+tags+CLIP+faces, OCR, 10 captions (s) | arena on: 1,837 [1,840, 1,837, 1,811] / 1,892 / 1,573; 132.8 [134, 132, 133], 137.8 [139, 138, 138], 30.3 [30, 30, 31] | shared: 1,337 [1,337, 1,335, 1,348] / 1,311 / 593; 133.8 [133, 134, 134], 142.3 [142, 142, 148], 30.6 [31, 31, 32] | peak **-500 MB (-27%)**, private -31%, after captions **-980 MB (-62%)**; scan +0.8% (noise), OCR +3.3%, captions +1% (noise) | yes (default `shared`) | round 1 (see git log) |
| 2 | ExifTool pool: idle processes stop after `LP_EXIF_IDLE_SECS` (60, new default), default `LP_EXIF_POOL` min(4, cores) -> min(2, cores) | W4 scan: wall (s), CPU (s), tree peak working set / private (MiB), tree 75 s after the rescan (MiB) | pool 4, kept: 124.6 [132.7, 124.3, 124.6], 691, 1,194 [1,181, 1,205, 1,194] / 1,262, idle 309 [299, 314, 309] | idle 60 s: 127.9 [128.8, 125.2, 127.9], 696, 1,192 [1,280, 1,156, 1,192], idle **133** [133, 136, 133]; pool 2: 125.2 [129.2, 125.0, 125.2], 693, **1,094** [1,086, 1,094, 1,110] / 1,179, idle 222 [218, 224, 222] | idle -176 MiB (-57%); pool 2: peak -100 MiB (-8%); speed within noise for both | yes (both defaults) | round 1 (see git log) |
| 3 | libvips threads per operation `LP_VIPS_CONCURRENCY` (default stays 2); operation cache was already off (`vips_cache_set_max(0)`, so `set_max_mem` has nothing to cap) | W4 scan: wall (s), CPU (s), server-process peak (MiB) | 2 threads: 124.6 [132.7, 124.3, 124.6], 691, 199 [199, 221, 197] | 1 thread: 123.2 [129.1, 123.1, 123.2], 685, 185 [185, 177, 188]; 0 (= 12, one per core): 130.9 [132.2, 129.7], 719, 232 [224, 239] | 1: -1% wall, -1% CPU, -14 MiB server (noise-level, tree peak unchanged); per-core: +5% wall, +4% CPU, +33 MiB | knob kept, default unchanged (2) | round 1 (see git log) |
| 4 | Thumbnails keep only the ICC profile (`webpsave keep=icc`, `LP_THUMB_KEEP=icc` new default; `all` = old, `none`) | W4: thumbnail bytes per photo (big / square / small), total; pHash; scan (s). Serving req/s (c=32, 8 s/cell, 3 alternating runs). Colour (Adobe-RGB-tagged JPEG) | `all`: 225,024 / 37,226 / 7,767 B, 546.79 MB; scan 124.6 [132.7, 124.3, 124.6]; square_small 3,398 [2,887, 3,398, 3,404], big 3,807 [4,510, 1,975, 3,807] | `icc`: 224,626 / 36,828 / 7,369 B, 544.37 MB; scan 124.9 [126.3, 124.2, 124.9]; square_small 3,871 [3,871, 2,681, 4,135], big 3,935 [3,908, 2,995, 3,935] | -398 B per thumbnail (-0.2% / -1.1% / -5.1%), -0.44% total; pHash identical 2,025/2,025 (x3 runs); scan and serving within noise; **no EXIF/GPS in any thumbnail**, ICC kept, colour diff 0 (`none`: 22 levels off on Adobe RGB) | yes (default `icc`) | round 1 (see git log) |
| 5 | Semantic search on MobileCLIP-S2 (`SEMANTIC_SEARCH_MODEL=mobileclip_s2`, new default; `clip_vit_b32` = old): with the tagger in-process, `tags.generate` stores the raw image embedding of its own MobileCLIP run as `clip_embeddings`, `clip.embed` waits for it and only fills gaps; queries use the MobileCLIP text tower; thresholds per model (search 27 -> 1.84, similar 90 -> 0.71) | ML-on scan (round 2 protocol, 2 alternating runs each): scan+tags+CLIP+faces (s), OCR (s), 10 captions (s), peak RSS / private (MB), RSS after the scan stage; search quality on 30 hand-labelled queries | ViT-B/32: 143.8 [138.8, 148.8] (2.02/s), OCR 157.9 [156.1, 159.6], captions 32.3 [32.5, 32.0], peak **1,314** [1,338, 1,290] / 1,271, after scan 891 [898, 885]; P@10 0.173 (ideal 0.200), R@20 0.899, MRR 0.840 | MobileCLIP: **118.7** [121.1, 116.3] (**2.44/s**), OCR 150.3 [158.1, 142.4], captions 31.8 [32.8, 30.7], peak **699** [699.2, 698.9] / 717, after scan 299 [276, 322]; P@10 0.193, R@20 0.959, MRR 0.872 | scan stage **-17.5%** (CLIP job 18.9 s -> 0.1 s), peak **-615 MB (-47%)**, OCR/captions within noise; search quality better on all three metrics | yes (default `mobileclip_s2`); existing ViT-B/32 embeddings are re-embedded once | see git log: `perf(backend-rs): round 2 #5 ...` |
| 6 | Face detector input size `LP_FACE_DET_SIZE` (`640` default = insightface `det_size`; `480`, `320`, `auto` = 320 then 640 when a face under 24 px at 320 was found) | ML-on scan, scan stage only (`--scan-only`, 3 runs 640/auto, 2 runs 480/320): scan+tags+CLIP+faces (s), faces job (s), scan-stage peak (MB); recall vs 640 on the corpus (63 faces incl. fixture users) and on the parity goldens (139 faces, 47 images) | 640: 115.9 [116.3, 114.9, 115.9], faces 23.3 [23.3, 23.3, 23.4], peak 346 [343, 346, 350]; goldens 139/139, 57.4 ms/image | 480: 113.4 [112.9, 113.8], faces 20.6; 320: 112.1 [112.7, 111.5], faces 19.0; **auto: 110.5** [110.5, 111.6, 110.5], faces **19.3** [19.3, 19.3, 19.4], peak 345 [345, 333, 346]. Corpus recall 63/63 for all three (320/auto also find 4 close-up Hanks portraits 640 misses; embedding cosine vs 640 min/mean 0.859/0.967, 0.403/0.941, 0.882/0.992); **goldens 126/139 (480), 124/139 (320), 126/139 (auto)**, 44.0 / 36.1 / 46.5 ms/image | auto: scan stage -4.7%, faces job -17%, RAM unchanged; but -9% face recall on the goldens (small faces in app screenshots and group thumbnails that the coarse pass does not see at all) | knob kept, default unchanged (640); `auto` opt-in fast mode | see git log: `perf(backend-rs): round 2 #6 ...` |
| 7 | int8 vision models (`bench/quantize_vision.py`: dynamic = int8 MatMul/Gemm weights for the transformer towers, int8 ConvInteger for the conv nets; static QDQ = per-channel int8, calibrated on 64 corpus photos, models upgraded to opset 13), stored as `<file>.onnx.int8` / `.onnx.qdq` next to the originals | Offline, same ORT 1.27 DLL, 4 intra-op threads, 149 corpus photos: ms per image, cosine vs fp32, MobileCLIP tag-set agreement (softmax x100, >= 0.02, top 10), SCRFD score maps | fp32: MobileCLIP 111.9 ms (143 MB file), ViT-B/32 69.1 ms (352 MB), ArcFace 8.3 ms (13.6 MB), SCRFD 14.6 ms (2.5 MB) | dynamic: MobileCLIP 114.9 ms (121.5 MB), cosine min/mean 0.9985/0.9991, **tag sets identical 57/149** (top-1 142/149, Jaccard 0.935); ViT 54.6 ms (96 MB), cosine 0.957/0.986; ArcFace 73.4 ms, cosine 0.772/0.924; SCRFD 183 ms. QDQ: MobileCLIP 185.7 ms, cosine 0.31 (broken); ViT 63.1 ms, cosine 0.35; ArcFace 25.8 ms, 0.87; SCRFD 17.6 ms | MobileCLIP: no speedup, -21 MB weights, tags change on 62% of photos; ViT: -21% time, -256 MB weights, cosine 0.986 (but ViT is no longer the default and is dominated by MobileCLIP); conv nets 3-12x slower (no VNNI on Zen+, ConvInteger has no fast path) | no (nothing wired into Rust; files kept for reruns) | see git log: `bench(backend-rs): round 2 #7 ...` |
| 8 | Parallelism in the scan stage: `LP_SCAN_CONCURRENCY` (new; default max(`WORKER_CONCURRENCY`, min(cores, 4)), was = workers) and `LP_ML_PIPELINE` (new, default on): tags decode/resize outside the model slot with 4 photos in flight regardless of the worker count, the face scan prepares 3 photos ahead (XMP regions + detection) and stores in order, reading the thumbnail size from its header and decoding it only when a face was found | ML-on scan: `--scan-only` matrix (2 runs each) and full runs (2 alternating each): scan stage (s), jobs (s), CPU-s of the stage, peak RSS (MB); outputs vs the serial path (faces, embeddings) | serial (pipeline 0, scan 1): scan-only 116.0 [116.0, 115.9], jobs scan 49.7 / tags 43.1 / faces 23.3, 251 CPU-s (2.2 cores), stage peak 348; full 116.6 [116.1, 117.1] (2.49/s), OCR 142.1, captions 30.6, peak **701** [703, 700] | pipeline: 98.6 [98.5, 98.6] (tags 37.1, faces 11.7); scan 4: 83.9 [83.4, 84.4] (scan 17.4); pipeline + scan 2: 74.5 [74.5, 74.5]; **pipeline + scan 4: 65.4** [64.9, 65.9] (scan 17.1, tags 37.2, faces 11.4, 250 CPU-s = 3.8 cores), stage peak 437; full **66.0** [66.0, 65.9, 64.9, 67.0] (**4.40/s**), OCR 141.8, captions 30.5, peak **816** [816, 816, 845, 749]; faces 63/63 identical boxes and encodings (cosine 1.0000), embeddings cosine >= 0.9999998 | scan stage **-43%** (2.49 -> 4.40 photos/s) for the same CPU-s; whole-run peak +115 MB (ExifTool: 4 processes + 4 console hosts instead of 2 + 2 still alive at the OCR peak, see #9); OCR, captions unchanged | yes (both defaults) | see git log: `perf(backend-rs): round 2 #8 ...` |
| 9 | ExifTool idle timeout `LP_EXIF_IDLE_SECS` 60 -> 15 (default) | ML-on scan, full (2 alternating runs each, defaults of #8): stages (s), peak RSS (MB) | 60 s: scan stage 66.0 [64.9, 67.0], OCR 141.0, captions 31.3, peak 797 [845, 749] (with #8's two runs: 816 [816, 816, 845, 749]) | 15 s: 65.9 [65.9, 65.9], OCR 140.6, captions 30.3, peak **725** [721, 729] | peak **-91 MB** (-11%), speed unchanged | yes (default 15) | see git log: `perf(backend-rs): round 2 #9 ...` |
| 10 | WebP quality of the 500 px and 250 px squares 95 -> 80 (`LP_THUMB_SMALL_Q`, new, default 80; big stays 95, pHash/ML read it); `exif_json` | ML-on scan `--scan-only` (3 alternating runs each): scan stage (s), bytes of the scanned library's squares; `thumb_quality.py` (289 big thumbnails of the corpus, libvips as `render.rs`): bytes, encode ms, SSIM/PSNR vs the uncompressed resize; serving `quick.py --contenders rust --endpoints media_square_small` (50k library's file swapped, 8 s/cell, 3 alternating runs, req/s) | Q95: scan stage 66.0 [64.8, 66.0, 66.0], squares 10.47 MB / 2.68 MB (36.2 / 9.3 KB each); offline 500 px 23.1 KB, 10.46 ms, SSIM 0.9734 (min 0.948), 250 px 6.4 KB, 3.42 ms, SSIM 0.9640; serving 3,233 [3,300, 3,184, 3,233] (5,402 B) | Q80: 65.9 [65.9, 64.8, 66.0], squares **3.27 MB / 1.10 MB** (11.3 / 3.8 KB); offline 500 px 7.8 KB, 6.78 ms, SSIM 0.9523 (min 0.857), PSNR 38.2 vs 40.6 dB, 250 px 2.8 KB, 2.36 ms, SSIM 0.9504; serving **4,476** [4,564, 4,388, 4,476] (2,222 B) | square bytes **-69% / -59%**, encode -35%, serving the small square **+38%**; scan stage and peak unchanged (encoding is ~13 ms of ~860 CPU-ms per photo); SSIM -0.02 (Q85: 0.959 / 0.954, Q90: 0.966 / 0.959) | yes (default 80) | see git log: `perf(backend-rs): round 2 #10 ...` |
| 11 | mimalloc as the global allocator (`lp-server --features mimalloc`, separate binary of the same commit) | ML-on scan, full (2 alternating runs each): stages (s), CPU-s, peak RSS (MB); API `quick.py --contenders rust` (50k library, all 16 endpoints, c=32, 4 s/cell, 2 alternating runs, req/s) | system allocator: scan stage 66.1 [66.1, 66.0], OCR 141.1, captions 30.5, 245 / 459 CPU-s (scan / OCR), peak **715** [727, 703] (librephotos-rs 642 / 618) | mimalloc: 66.0 [66.0, 66.0], OCR 143.0 [144.8, 141.1], captions 30.5, 245 / 464 CPU-s, peak **861** [874, 848] (librephotos-rs 788 / 763); API geometric mean of the 16 endpoint ratios **-0.1%** (per endpoint -10% ... +13%, inside the run-to-run spread) | speed unchanged (scan, OCR, API); peak **+146 MB (+20%)** | no (reverted; the feature was not kept) | see git log: `bench(backend-rs): round 2 #11/#12 ...` |
| 12 | ONNX Runtime graph optimisation cached on disk (`with_optimized_model_path` once, then load the optimised copy with optimisation off), to speed up reloads after the 120 s idle unload | `examples/ort_load.rs`: session load time per model (3 loads each, ms), ORT 1.27, 4 intra-op threads | load as today: MobileCLIP vision 405 [418, 400, 396], MobileCLIP text 456, ViT-B/32 vision 601, SCRFD 26, ArcFace 34, OCR det 59, OCR rec 99 | pre-optimised (level all / extended): MobileCLIP vision 142 [142, 149, 134], text 333, ViT vision 426, SCRFD 13, ArcFace 18, OCR det 26-32, OCR rec 35; first optimise+save 1.2-2.2x a plain load; LFM2-VL (external-data files) not measurable this way | -0.26 s per MobileCLIP image-tower reload, ~-0.5 s for the whole default set; the scan loads each model once (<1% of the 66 s stage) | no (not worth a cache of hardware-specific model files next to the downloads) | see git log: `bench(backend-rs): round 2 #11/#12 ...` |
| 13 | OCR only where there is text, plus decoding outside the OCR slot: under `LP_ML_PIPELINE` the original is decoded on a blocking thread (4 photos in flight) and the slot only runs the models; `LP_OCR_PREPASS=<side>` (new, off by default) first runs detection at that side and returns an empty result when it finds no box | ML-on scan, full (2 alternating runs each): OCR stage (s), OCR CPU-s, peak RSS (MB), OCR text vs the serial path (words, photos with text); `examples/ocr_prepass.rs` (297 corpus images, ppocrv6_small, 4 threads): ms per image | serial OCR (`LP_ML_PIPELINE=0`): **142.1** [142.0, 142.1], 457 CPU-s, peak 702 [703, 701]; 221 of 289 photos with text, 597 words | pipelined: **135.4** [135.9, 134.9], 470 CPU-s, peak 807 [816, 799] (see #14); prepass 640: 157.4 [158.0, 156.7], 551 CPU-s, peak 750 [703, 796]; both: 597/597 words, 221/221 photos. Offline: full pipeline 554 ms (text) / 202 ms (no text); 640 prepass 85 / 73 ms; 0 of 228 text photos missed | pipelined OCR **-4.7%**; prepass +16% on this corpus (76% of its photos carry text: every generated phone image is a poster), break-even at 60% photos with text; at 20% it would cut OCR by ~32% | pipelined decode: yes (default); prepass: knob, off by default | see git log: `perf(backend-rs): round 2 #13 ...` |
| 14 | Stop idle ExifTool processes when the scan job and the face scan finish (`ExifPool::shutdown`), instead of waiting out the 15 s idle timeout | ML-on scan, full (2 alternating runs, previous binary vs this one): stages (s), peak RSS (MB), where the peak falls | previous: scan stage 65.9 [66.0, 65.8], OCR 134.6 [134.6, 134.5], captions 30.5, peak **853** [878, 828] (twice in the first 12 s of OCR: 4 decoded originals in flight plus the face scan's 2 ExifTool processes and console hosts, 85 MB) | this: 65.4 [65.9, 64.8], OCR 135.7 [135.5, 135.8], captions 30.6, peak **730** [734, 727] (librephotos-rs alone, mid-OCR or captions) | peak **-123 MB**, speed unchanged | yes | see git log: `perf(backend-rs): round 2 #14 ...` |
| 15 | Correctness fix of #5: the producing model is recorded per embedding (`api_photo.clip_embeddings_model`, new nullable column, NULL = Django = ViT-B/32) instead of guessed from the magnitude; switching models never NULLs embeddings: the index and similar photos use only the selected model's, `clip.embed` replaces the others in place; a trigger resets the column when a non-`librephotos-rs` connection (Django) changes an embedding | ML-on scan, full (3 alternating runs, f470b0761 binary vs this one): scan stage (s, photos/s), OCR (s), 10 captions (s), scan CPU-s, peak RSS (MB); startup check on the 50k library (clone with a synthetic embedding on all 50,031 photos) | scan stage 67.3 [68.4, 66.2, 67.3] (4.31/s), OCR 135.0 [135.2, 135.0, 134.5], captions 30.5, 246.4 CPU-s, peak **754** [735, 754, 755] | scan stage 66.1 [66.1, 66.1, 66.1] (4.39/s), OCR 134.8 [135.9, 134.8, 134.4], captions 30.3, 245.5 CPU-s, peak **752** [755, 750, 752]; startup check 35-59 ms with nothing to convert (query 16 ms: seq scan of 3,527 heap pages, embeddings stay in TOAST), 78-96 ms with all 5 users to convert (query 20-22 ms) | neutral: scan -1.8% and peak -2 MB, both inside the baseline's spread; no index needed | yes (fix) | see git log: `fix(backend-rs): round 2 #15 ...` |
| 16 | GPU execution provider (round 3, W4 benchmark below): `ONNX_PROVIDERS` takes `DmlExecutionProvider` (DirectML, new) next to CUDA and CPU, short names `dml`/`cuda`/`cpu`, unset = CUDA, DirectML, CPU (first one the loaded runtime offers; CPU always last); `DirectML.dll` next to `LP_ORT_LIB` is preloaded (System32 has an older one); DirectML sessions run without memory pattern, sequentially | W4 ML-on scan stage (2,025 files, unpinned, 6 intra-op threads, 1 worker): wall (s) and photos/s, jobs scan / tags / faces (s), CPU-s, peak RSS (MB), VRAM (MiB, nvidia-smi delta); parity goldens on the GPU | CPU (onnxruntime 1.27): **460.5** [460.5, >= 500 (cut in faces)] (**4.40** / <= 4.05 per s), scan 146 / 136, tags 252 / 328, faces 61 / cut, 2,576 / 2,490 CPU-s, peak 920 / 878; at 12 threads: cut at 480 s in tags (1,675 / 2,025, ~200 ms per photo vs ~125 at 6), 3,997 CPU-s | DirectML (onnxruntime-directml 1.24.4): **255.8** [250.0, 261.5] (**7.92/s**), scan 131 / 137, tags **71 / 75**, faces 48 / 49, **725 / 755 CPU-s**, peak **775** [735, 814], VRAM 267-329; CUDA (onnxruntime-gpu 1.27 + CUDA 13.4 + cuDNN 9.13, one run): 271.9 (7.45/s), tags 82, faces 51, 800 CPU-s, peak 1,049 (private 2,307), VRAM 837 | **+80% photos/s**, CPU-s **-71%**, peak RSS -150 MB (DirectML) / +130 MB (CUDA); tags job 3.5x faster, faces 1.25x (both now bound by decoding and the per-photo ExifTool / DB work, GPU 15-25% busy); parity: tags 82/82 identical sets, scores within 6.8e-6, embedding cosine 1.000000; faces 12/12 golden tests pass, same boxes, same-crop embedding cosine >= 0.999999998 | yes (default: GPU when the runtime offers one) | see git log: `perf(backend-rs): round 3 #16 ...` |
| 17 | Batched inference across photos (`lp_ml::batch`, `LP_ML_BATCH`): the tags job keeps 2 batches of photos in flight, prepared photos queue up, one leader runs everything queued through the MobileCLIP image tower in batches (DirectML: 16-32, smaller groups one by one; CUDA 2-64; CPU off: no gain); ArcFace embeds all faces of a photo in one run (not on DirectML: it rejects batch > 1 for buffalo_sc's recogniser); decoding bounded to one blocking task per hardware thread | W4 ML-on scan stage, DirectML, 6 threads, inline ML off: wall (s), tags job (s), VRAM (MiB, server process); `examples/tags_batch.rs` (ms per image) | batch off (`LP_ML_BATCH=1`), same session: **466** [431.6, >= 500.7 (cut)], tags 255 [235, 275]; earlier sessions 284 [281.1, 267.0, 288.5, 287.4], tags 69-98; VRAM 283 | batched: **317** [319.8, 314.3], tags **98** [111.6, 85.1]; VRAM **1,483-1,748**, private bytes 1.9 GB (staging for 32-image inputs); offline: b1 20.1, b16 15.1, b32 11.4 ms per image (b2 64, b4 45: small batches are slower than single runs on DirectML) | same session -32% wall, tags -62%; but the tags job swings 69-275 s with or without batching: it is bound by its per-photo album writes (#18), not by inference; +1.2-1.5 GB VRAM | yes (default on GPU, 32/16 on DirectML), kept for the overlapped pipeline (#19) where GPU time per photo matters | see git log: `perf(backend-rs): round 3 #17 ...` |
| 18 | Batched tag writes (`LP_TAG_STORE_BATCH`, default 64; `1` = per photo): tag results queue up and one writer stores up to 64 photos per transaction (embeddings and captions through `unnest`, memberships in tagging order, every touched `AlbumThing` locked, recounted and given covers once per batch, search captions rebuilt in one statement); write queue per database | W4 ML-on scan stage, DirectML + #17, inline off (2 alternating runs each): wall (s), tags job (s); `cargo test -p lp-tasks --test tags_inprocess --test tags_ocr` with 1 and 64 | per photo: 284 [272.6, 296.1] (7.13/s), tags **79** [75.4, 82.3] | batched: **262** [256.3, 267.1] (7.74/s), tags **51** [53.9, 48.0] (~40 photos/s, stored in bursts of 36-44 per second instead of 10-33) | tags job **-36%**, stage -8% (the scan job's own spread, 148-169 s, is as large as the gain); same rows (tests pass with either setting) | yes (default 64) | see git log: `perf(backend-rs): round 3 #18 ...` |
| 19 | Overlap the stages: ML inside the scan (`LP_SCAN_INLINE_ML`, new default `auto` = on when ONNX Runtime runs on a GPU, `0` = follow-up jobs as before): every photo the scan renders goes to the tagger (batched, #17), the tag writer (#18) and the face detector as soon as its rows are written, up to 64 photos in flight; the `tags.generate` / `clip.embed` / `faces.scan` follow-ups still run and only pick up what the scan did not cover (videos, failures). Pixels from libvips' big thumbnail before the WebP encode (#20 adds the WebP source) | W4 ML-on scan stage, DirectML, 6 threads (2 alternating runs each, one binary): wall (s) and photos/s, jobs scan / tags / faces (s), CPU-s, peak RSS (MB), VRAM (MiB) | follow-ups: **234.8** [237.8, 231.8] (**8.63/s** [8.52, 8.74]), scan 144 / 141, tags 45 / 42, faces 48 / 48, 784 CPU-s, peak 873 [834, 911], VRAM 1,203-1,481 | inline: **156.2** [156.6, 155.7] (**12.97/s** [12.93, 13.01]; 4 more runs of the same binary 12.86, 13.01, 13.08, 13.12), scan job 154.4 / 153.9 (all ML inside), tags 0.8, faces 0.5, 766 CPU-s, peak **1,236** [1,168, 1,305] (librephotos-rs 457-476 MB: photos in flight + GPU staging; 4 ExifTool processes at once instead of 2), VRAM 1,635-1,650 | **+50% photos/s**, CPU-s -2%; peak +363 MB (inside the 4 GB budget) | yes (default on the GPU; CPU keeps the follow-ups) | see git log: `perf(backend-rs): round 3 #19 ...` |
| 20 | Decode once, two sources for the inline ML (`LP_SCAN_INLINE_ML_SOURCE`): `webp` (new default) = the big WebP decoded once (libwebp) for the pHash **and** the models, the very pixels the follow-up jobs decode from the file; `pixels` = libvips' RGB before the WebP encode (#19's behaviour, no decode for ML) | W4 ML-on scan stage, inline on (3 alternating runs each, one binary): wall (s), photos/s, CPU-s, peak RSS (MB); parity on the 290-photo corpus (DirectML, `ml_parity.py`, follow-up path = reference); `scan_costs` (libwebp vs `image` crate decode of 50 W4 big thumbnails) | `pixels`: 167.6 [153.1, 167.6, 169.7] (**12.08/s** [13.23, 12.08, 11.93]), 786 CPU-s, peak 1,165 [1,087, 1,439, 1,165]; parity vs the follow-ups: tag lists identical on 105/289 photos (sets 218/289, top-1 284/289, Jaccard 0.959), embedding cosine min/mean 0.9911/0.9995, faces 51/51 with box IoU min 0.972, encoding cosine min 0.982 | `webp`: 166.8 [170.3, 166.8, 160.3] (**12.14/s** [11.89, 12.14, 12.63]), 783 CPU-s, peak 1,216 [1,301, 1,114, 1,216]; parity: **identical** (289/289 tag lists, cosine 1.000000, 51/51 faces IoU 1.0, encodings 1.000000); decoders bit-identical 50/50 | speed and RAM within noise (the pHash decodes the WebP anyway; libvips' readout is 0.6 ms); `pixels` drifts (Q95 loss: the models see a different image than the follow-ups and Django) | `webp` default; `pixels` kept as an option | see git log: `perf(backend-rs): round 3 #20 ...` |
| 21 | Use the 12 threads on the CPU side: scan concurrency default min(cores, 4) -> **min(cores, 8)** file groups at once (`LP_SCAN_CONCURRENCY`; a 4-core box stays at 4), libvips threads per operation (`LP_VIPS_CONCURRENCY`) default 2 -> **1**; plus `LP_SCAN_TIMERS=1` (per-stage wall-clock totals of the scan, logged at its end) | W4 ML-on scan stage, DirectML, inline ML (#19/#20): sweep 4 / 8 / 12 / 16 groups (1 run each, CPU split per executable), then 4 vs 8 vs 8 + vips 1 round robin (2 runs each, one binary): photos/s, CPU-s, peak RSS (MB); system CPU busy (typeperf) | 4 groups, vips 2: **11.71/s** [11.49, 11.93] (sweep: 12.75), 788 CPU-s, peak 1,099 [1,074, 1,123] | 8 groups, vips 2: 15.21/s [15.76, 14.66] (sweep 15.33, timers run 15.01), 783 CPU-s, peak 1,203; **8 groups, vips 1: 16.21/s** [16.19, 16.23] (sweep 16.02), 774 CPU-s, peak **1,172** [1,136, 1,207]; 12 groups: 14.47 (vips 1: 14.94); 16 groups: 15.56 / 14.48 | **+38% photos/s** (11.7 -> 16.2), same CPU-s, peak +73 MB; 12-16 groups oversubscribe (render 347 -> 436-460 ms per photo, inline back-pressure 22 -> 173-261 ms) | yes (defaults 8 groups, vips 1) | see git log: `perf(backend-rs): round 3 #21 ...` |
| 22 | WebP effort knobs: `LP_THUMB_EFFORT` (big thumbnail) and `LP_THUMB_SMALL_EFFORT` (squares), both default 2 as before (Django's `effort=2`) | `bench/thumb_effort.py` (one thread, 50 W4 + 74 corpus JPEGs, libvips as `render.rs`): KB, encode ms, SSIM / PSNR vs the uncompressed resize, pHash vs effort 2; W4 ML-on scan stage with `LP_THUMB_EFFORT=0` (round robin with #23, 2 runs each) | effort 2: big 210.6 KB / 66.0 ms / SSIM 0.9716 (corpus 174.5 KB / 56.0 ms / 0.9760); 500 px 5.6 KB / 6.2 ms, 250 px 1.8 KB / 2.3 ms; scan **15.62/s** [15.26, 15.98], 775 CPU-s [778, 772], peak 1,149 [1,097, 1,200] | big effort 0: 216.6 KB (+2.8%) / **45.0 ms (-32%)** / SSIM 0.9713 (corpus +3.5% / -31% / 0.9758); pHash equal on 28/50 and 40/74 photos, others 1-4 bits apart (max 4); squares effort 0: -35% encode time but +38-50% bytes; scan **15.76/s** [15.41, 16.11], **712 CPU-s [712, 711] (-8%)**, peak 1,147 [1,218, 1,076] | big effort 0: -8% CPU-s, speed within noise (the scan is not CPU-bound at 8 groups, see #24), +3% bytes, and the pHash of ~half the new photos moves by up to 4 bits against thumbnails rendered at effort 2 (Django, earlier scans: duplicate detection and the replaced-file check compare them) | no (knobs kept, default 2; effort 0 is a CPU-saving option) | see git log: `bench(backend-rs): round 3 #22/#23 ...` |
| 23 | Region probe (`LP_SCAN_REGION_PROBE=1`, off by default): the scan's metadata read also asks for `XMP:RegionAreaX`; the inline face step skips its own structured ExifTool read (`XMP:RegionInfo`, one round trip per photo) when no file of the photo has a region area | W4 ML-on scan stage (round robin with #22, 2 runs each): photos/s, CPU-s; timers: region read 12-16 ms per photo | 15.62/s [15.26, 15.98], 775 CPU-s | **15.50/s** [15.41, 15.58], 769 CPU-s [767, 770] | within noise: the read overlaps detection (ExifTool CPU ~10 ms per photo, in its own process) | no (knob kept, off) | see git log: `bench(backend-rs): round 3 #22/#23 ...` |
| 24 | Longest jobs first: the scan starts the file groups that contain a video before the photos (`LP_SCAN_VIDEOS_FIRST`, default on; `0` = walk order). The walk put `Videos/` last, so every scan ended with ffmpeg on a few videos (~25 s each) and idle cores | W4 ML-on scan stage (2 alternating runs each, one binary); `LP_SCAN_TIMERS` completion curve (seconds until 25/50/90/99/100% of the file groups were done) | walk order: **14.59/s** [14.21, 14.96], 786 CPU-s; curve (default run, s24_default_timers) p25 25.0, p50 49.5, p90 89.9, p99 **98.5**, p100 **124.7** s: the last 20 groups (5 videos, 24 s each) took 26 s | videos first: **15.98/s** [15.94, 16.02], 745 CPU-s, peak 1,341 [1,355, 1,326]; curve p25 45.7, p50 70.6, p90 115.9, p99 124.9, p100 125.3 s (the videos now overlap the photos; the box is 99% busy throughout) | **+9.5% photos/s**, -5% CPU-s; peak +100-200 MB (5 ffmpeg processes now run beside 8 photo groups instead of after them) | yes (default) | see git log: `perf(backend-rs): round 3 #24 ...` |

## Notes

**1. ORT arena.** Four settings, ML-on scan (3 runs on/off/shared, 2 shrink) and per model
(2 runs each, fresh process; RSS after the service / peak, MB):

| | scan peak | after captions | OCR s | captions s | OCR model | caption | CLIP | tags | faces |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| on (old default) | 1,837 | 1,573 | 137.8 | 30.3 | 543 / 551 | 607 / 612 | 699 / 706 | 262 / 332 | 184 / 184 |
| off | 1,325 | 524 | 146.1 | 31.3 | 130 / 282 | 393 / 459 | 689 / 699 | 241 / 283 | 150 / 156 |
| shrink (per session) | 1,404 | 756 | 142.7 | 30.3 | 166 / 399 | 478 / 503 | 691 / 706 | 246 / 293 | 160 / 162 |
| **shared** (new default) | 1,337 | 593 | 142.3 | 30.6 | 146 / 380 | 452 / 540 | 688 / 708 | 244 / 276 | 159 / 159 |

`shared` dominates `shrink` on every number; against `off` it is 2.6% faster on OCR for
+12 MB peak and +69 MB after captions, so `on` (fastest, +500 MB), `shared` and `off`
(least RAM) are the Pareto points and `shared` the default. Captions no longer pay much for
the arena (off: +3%; the 2-3x of the first port is gone). All runs: identical counts (290
photos, 289 tagged/CLIP, 51 faces all clustered, 288 OCR rows, 10 captions). The caption
decoder shrinks only after the prefill step (`runtime::run_keep` for the per-token steps,
which reuse the same buffers). Scan stage (tags/CLIP/faces) is unaffected in every mode.

**2. ExifTool pool.** Share of the W4 tree: 4 `exiftool.exe` x ~37 MiB + 4 `conhost.exe`
x 7.6 MiB (Windows console hosts) = ~178 MiB, 15% of the scan peak and 58% of the idle
tree (309 MiB). Processes were already spawned lazily; new is the reaper (holds the pool
weakly, ends when no process is left) and LIFO reuse, so surplus processes age out after
a burst. Two processes keep up with 6 scan workers because metadata is read in batches.
The tree peak is dominated by ffmpeg (5 processes, ~950 MiB at the peak: video
thumbnails/transcodes), which makes the peak noisy (1,156-1,280 MiB with the same pool).

**3. libvips.** Concurrency is global in libvips (not per worker); 6 scan workers each
running a 2-thread operation already fill the 6 CPUs. 1 thread is within noise of 2; one
thread per core oversubscribes. Not changed.

**4. Thumbnail metadata.** `keep_check` (scratch script: ICC-tagged Adobe RGB JPEG with
GPS, sRGB JPEG with GPS, three fixture trip photos with GPS, scanned under each setting):
`all` keeps EXIF incl. GPS in every thumbnail (big, square, small), `icc` keeps the 540 B
profile and nothing else, mean colour after ICC conversion identical; `none` drops the
profile and the Adobe RGB thumbnail is 22 levels off. The generated W4 library has small
EXIF blocks (~330-440 B); camera files with maker notes carry several KB up to 64 KB, so
real savings per thumbnail are larger (not measured). Serving: the 50k library's two
quick.py thumbnails swapped for stripped copies (same VP8 bitstream, 15,548 -> 15,210 B and
5,402 -> 5,064 B; restored as hard links afterwards); differences are inside the run-to-run
noise of this box (1,975-4,510 req/s for the same file). **Django follow-up (separate small
PR):** `api/thumbnails.py` writes every WebP with `WEBP = {"Q": 95, "effort": 2}` and
libvips' default metadata, so Django thumbnails also carry the original's EXIF/GPS; add
`"keep": pyvips.enums.ForeignKeep.ICC` (libvips >= 8.15; the image ships 8.18) to `WEBP`.
Existing thumbnails keep their EXIF until they are re-rendered (both backends).

## Round 2 (target: scan stage >= 4 photos/s with the whole run < 1,000 MB)

Same ML-on scan as round 1 (`ml_footprint.py scan rs`, 290 photos, 4 pinned cores, 1 worker),
now with `--site KEY=VALUE` (site setting rows of the run's DB) and CPU seconds per stage
(`cpu_s`, from #6 on). Baseline of the round: 143.8 s (2.02 photos/s), peak 1,314 MB.

**5. One vision model per photo.** Before, every photo went through two image towers:
MobileCLIP-S2 (256 px, tags) and CLIP ViT-B/32 (224 px, search; vision + text towers = 690 MB
resident, loaded for the whole scan). The ViT-B/32 slot stayed loaded through most of the
OCR stage (120 s idle unload), which is where round 1's 1.34 GB peak sat (OCR arena + CLIP +
tagger + faces). With `SEMANTIC_SEARCH_MODEL=mobileclip_s2` the tagger's run also yields the
search embedding (the pooled image output before normalisation, magnitude ~1), stored in
the same transaction as the tags; `clip.embed` is chained after `tags.generate` and only
embeds photos the tagger skipped (through the tagger slot, so no second copy of the model)
and rebuilds the index. Text queries load only the MobileCLIP text tower (254 MB, idle
unload as before; the ViT text tower is 254 MB too, plus its 352 MB vision tower).

- Quality (`quality.py`, scratch): stored embeddings of one kept run per model, 30 queries
  hand-labelled on the corpus (16 skimage/astronaut/portrait/group scenes, masks, documents,
  receipt, sign, poster, handwriting, the 26 synthetic shape images; variants of one source
  count as relevant together), ranked by the raw inner product as the index does.
  ViT-B/32: P@10 0.173, R@20 0.899, MRR 0.840; MobileCLIP-S2: P@10 0.193, R@20 0.959,
  MRR 0.872 (ideal P@10 0.200: most queries have one relevant photo). Per query MobileCLIP is
  better on "an astronaut" (R@20 0.2 -> 1.0: ViT's raw inner product favours its high-norm
  images), "a printed document page" (0 -> 1.0), moon, microscope, receipt; worse only on
  "a logo" (MRR 1.0 -> 0.06). The corpus is small and mostly synthetic; the result says
  "comparable or better", not more.
- Thresholds: raw scales differ (ViT image/text norms ~10.4/9.6, MobileCLIP 0.97/9.6), so the
  cuts are calibrated to the same mean number of hits: search 27 -> 1.84 (10.1 vs 10.2 photos
  per query; thresholded precision/recall 0.445/0.701 -> 0.528/0.938), similar photos
  90 -> 0.71 (77.9 vs 77.8 per photo; the corpus is dominated by near-identical generated
  gradients).
- Switching (superseded by #15, which records the model instead of guessing it and never
  drops embeddings): ViT-B/32 embeddings have magnitude ~9-12, MobileCLIP ~0.9-1.2, so
  `lp_tasks::clip::reembed_mismatched` (startup + site settings POST) drops the embeddings
  the selected model cannot have produced (magnitude split at 3) and queues `clip.embed` for
  their owners: **an existing library re-embeds once** (one MobileCLIP image pass, ~0.15 s
  per photo on 4 cores) and search is degraded until it finishes. `LP_ML_CLIP=sidecar` keeps
  ViT-B/32 (the Python sidecar runs nothing else), and ViT-B/32 is no longer downloaded
  unless selected. Django on the same database would still query with ViT-B/32 (Rust-only
  setting).
- Remaining scan stage (MobileCLIP): scan 51 s, tags 43.7 s, faces 24.5 s, all sequential.

**6. Face detection size.** SCRFD (`det_500m`, dynamic input) letterboxes the big thumbnail
into a det_size square; the face job is 23 s of the 116 s scan stage, of which detection at
640 is ~57 ms/photo on 4 threads (`examples/face_det_sizes.rs`), the rest decoding (twice:
the job decodes the thumbnail for the crops, the service again for detection), the XMP region
read (one ExifTool round trip per photo) and the ArcFace embeddings. Smaller inputs save at
most ~4 s of the stage. On the bench corpus every smaller size keeps all 63 faces, and 320/auto
additionally find the four tight `portrait_hanks_*` close-ups (face fills the frame, too big
for 640's anchors). The parity goldens tell the other half: screenshots with face thumbnails
and the e2e group thumbnails have faces only 640 resolves, and `auto` cannot recover them
because the 320 pass returns nothing to trigger on (a "no face -> 640" fallback would cost
320 + 640 on every face-less photo, i.e. most of a library). A 9% recall loss is not worth
4.7% of the stage, so 640 stays; `LP_FACE_DET_SIZE=auto` is documented as a fast mode for
libraries of close-up photos. `ml_footprint.py` gained `--scan-only` (stop after the scan
stage, 2.5 min per run) and per-stage CPU seconds (`cpu_s`): the scan stage uses 240-255
CPU-s over ~113 s, i.e. **2.2 of the 4 cores** on average.

**7. int8.** ONNX Runtime's int8 kernels pay off where the weights dominate and the op is a
GEMM: the ViT-B/32 tower (dynamic, -21% time, 3.7x smaller). MobileCLIP-S2's image tower is a
mostly-convolutional MCi2 (FastViT-style reparameterised convs), so dynamic quantisation only
reaches its few MatMuls (143 -> 121.5 MB, same speed), and static QDQ wrecks it (cosine 0.31:
the reparameterised branches have activation ranges a 64-image MinMax calibration does not
capture; entropy/percentile calibration and excluding the attention blocks would be the next
try). The tags are a softmax over 938 prompts at logit scale 100, so even 0.999 cosine flips the
tag set of 62% of photos (mostly the low-probability tail; top-1 agrees on 95%). Dynamic int8
convolutions (`ConvInteger`) and QDQ on this AVX2-only CPU are 3-12x slower than fp32 for
ArcFace and SCRFD. Arm64 (Pi 5, dot-product instructions) may rank these differently; not
measurable here. Since no variant improves the default configuration, nothing was wired into
the Rust loader.

**8. Parallelism inside the scan stage.** With one worker the stage ran strictly serial: the scan
job processed one file group at a time (its concurrency was `WORKER_CONCURRENCY`), `tags.generate`
one photo at a time (`for_each_photo` clamps to the worker count) with decoding inside the model
slot, and `faces.scan` one photo at a time with two full decodes of the big thumbnail (one for the
crops, one in the face service) and an ExifTool round trip in between. 2.2 of the 4 cores were busy
on average. Now the scan renders up to 4 groups at once (thumbnails, metadata batches, pHash; ~40 MB
more), the tagger only runs the model in its slot while the next photos decode, and the face scan
overlaps XMP reads and detection of the next 3 photos with storing the current one (the crop decode
only happens for the ~5% of photos with faces). The CPU work is unchanged (250 CPU-s); the stage now
keeps 3.8 of 4 cores busy, so further speed has to come from doing less work.
`LP_ML_PIPELINE=0` restores the serial path (kept for A/B). `for_each_photo`'s 4 in flight also
apply to OCR and geocoding under the pipeline (OCR time unchanged: its slot serialises the work).
Not done: batching the image tower. MobileCLIP-S2 is a convolutional net that is compute-bound at
batch 1 (offline, same ORT, 4 threads: 109.6 / 108.9 / 105.5 / 120.5 / 107.5 ms per image at batch
1 / 4 / 8 / 16 / 32), so the CLIP batch size (32, ViT-B/32 only now) was not varied either. Running
tags and faces side by side with 2 intra-op threads each was not tried: with the stage at 3.8 cores
the gain is bounded by ORT's per-thread efficiency (2 threads: 180 ms vs 4 threads: 110 ms per
MobileCLIP image, i.e. ~+20%) and needs a second worker or a merged job.

**9. ExifTool idle timeout.** With #8 both lanes run 2 processes (plain for the scan's metadata
batches, `-struct` for the face scan's XMP regions), ~36 MB of perl plus a 7 MB console host each
on Windows. The scan stage ends ~50 s after the plain lane's last use and the OCR stage peaks ~20 s
later, while round 1's 60 s timeout still held all four. 15 s releases them before OCR's peak; a
respawn costs one perl start-up (~0.3 s), negligible against 15 s of idleness.

**10. Cheaper square thumbnails.** The grid shows the 250 px and 500 px squares; at Q95 they
cost more than a third of the big thumbnail's bytes (36 KB vs 174 KB per photo on the corpus).
Q80 keeps SSIM above 0.95 on average (the minimum, 0.857, is a fine-detail scene) and is what
most web pipelines ship; the big thumbnail (lightbox, pHash, CLIP/tags/faces input) stays at 95.
The scan's own bytes are larger than the offline re-render's (36 vs 23 KB) because the scan
resizes from the decoded original, the script from the Q95 big WebP; the ratio is the same.
Serving: one 2.2 KB instead of 5.4 KB file moved the small-thumbnail endpoint from ~3.2k to
~4.5k req/s in all three alternating pairs (the per-request work is copying the body).
Existing thumbnails stay Q95 until regenerated; Django still renders Q95 (follow-up: its
`api/thumbnails.py` WEBP options, together with round 1's `keep=icc`).
`exif_json`: nothing to do. Neither backend writes it any more (Django's ingest moved to
`PhotoMetadata`; no Rust statement sets the column): 0 of the 38 fixture rows carry it.

**11. mimalloc.** The Rust heap is a small part of the process (ONNX Runtime and libvips allocate in
their own DLLs, the shared ORT arena holds the model activations); what Rust allocates per photo
(decoded thumbnails, tensors, JSON) is short-lived and multi-threaded, which mimalloc keeps in
per-thread segments instead of returning it: +146 MB at the OCR peak for no speed change in the
scan, OCR or the API. The Windows heap (segment heap / LFH) is already good for this workload.
On Linux glibc malloc would be the comparison (not measurable here); not pursued.

**12. Cached graph optimisation.** Graph optimisation is ~65% of the MobileCLIP image tower's load
(405 -> 142 ms) and ~30-70% for the others, but a model loads once per scan and once per idle
unload, so the default set gains ~0.5 s per reload. Caching optimised files (ORT marks level-all
output as hardware-specific) next to the sha256-pinned downloads is not worth it; the load-time
table is kept as a reference (`examples/ort_load.rs`).

**13. OCR.** The OCR job reads the original (cv2-decodable) file, not a thumbnail, so decoding a
multi-megapixel JPEG happened inside the model slot. With #8's 4 photos in flight, decoding moved
to a blocking thread (-4.7% stage time, the slot keeps the cores busier). A text-free photo still
costs 202 ms (decode + detection at max side 1600 + an empty recognition); a 640 px detection
finds every text photo of the corpus (0 of 228 missed, 597/597 words kept in the scan) for 73-85
ms. The bench corpus is the wrong library to judge the gate: its 188 generated phone images are
all text posters, so 76% of photos carry text and the gate costs 16%. A real photo library has
far fewer text photos; below 60% the gate wins (estimate from the per-image costs: -32% at 20%).
It stays opt-in until measured on a real library (and with small text: receipts shot from a
distance are the case a 640 px pass could miss). A cheaper alternative gate,
`is_document`/`is_screenshot`, would have dropped the text of most corpus photos (posters,
signs) and was not pursued.

**14. ExifTool after batch jobs.** #9's 15 s timeout was not enough once OCR started decoding 4
originals at a time (#13): the face scan's `-struct` processes from the last XMP reads were still
alive in OCR's first seconds. Batch jobs now stop the idle processes as they finish (busy ones
are unaffected; the next command respawns one, ~0.3 s). The remaining peak is the backend
process itself (~730 MB: OCR's arena and decoded originals, or the caption model).

**15. Recording the embedding's model.** #5 told the two models apart by magnitude (split
at 3) and, at every start and settings change, NULLed the embeddings that did not fit and queued
`clip.embed`. That guessed wrong on the contract fixture's synthetic embeddings (magnitude 1 under
the ViT-B/32 sidecar: the `similar_photos` share twin failed), destroyed data on a guess, would
fight a Django sharing the database (Django writes ViT-B/32, every Rust start dropped it again),
and left search dark until the re-embedding finished. Now migration
`202610041200_search_clip_embeddings_model` adds `api_photo.clip_embeddings_model` (`clip_vit_b32`,
`mobileclip_s2`; NULL = written by Django, or by Rust before the column, = ViT-B/32) and every Rust
write sets it (`clip.embed`, `tags.generate`'s shared embedding). The similarity index (build,
stale-index check) and the photo detail's similar photos take only the selected model's
embeddings, so the other model's rows are ignored, not dropped; `reembed_mismatched` only queues
`clip.embed` for owners of mismatched rows (once: not while one is queued), and `clip.embed`
replaces them in place, rebuilding the index first (without them), every max(2,000, index size)
photos and at the end, so converted photos become searchable as the conversion runs. A `full`
run also re-embeds in place now. Django saves whole rows without knowing the column, so a
`BEFORE UPDATE OF clip_embeddings` trigger NULLs it when a connection whose `application_name` is
not `librephotos-rs` (the pool's and the testkit's) changes the embedding: a stale Django save over
a Rust re-embedding is then seen as ViT-B/32 again. Caveats: embeddings written by round-2 binaries
before this column carry NULL and are re-embedded once (experiment databases only); a photo whose
thumbnail is missing keeps its old-model embedding and makes every start queue a (short) job for
its owner.

## Round 2 Pareto table

ML-on scan (`ml_footprint.py scan rs`, 290 photos, 4 pinned cores, 1 worker), full runs: scan
stage = scan + tags + CLIP + faces; peak = working set of the whole tree over the whole run
(scan, face training, OCR, 10 captions). Medians [runs]. Rows 4-8: HEAD of round 2
(`bdc72a912`), one binary, alternating, measured in one session; rows 1-3 from #5/#8 (same
protocol, earlier binaries of the round).

| setting | scan stage s (photos/s) | OCR s | 10 captions s | peak RSS MB | >= 4/s and < 1 GB? |
|---|---:|---:|---:|---:|---|
| 1. round 1 default: ViT-B/32 search + MobileCLIP tags, serial stage (#5 baseline) | 143.8 [138.8, 148.8] (2.02) | 157.9 | 32.3 | 1,314 [1,338, 1,290] | no |
| 2. MobileCLIP-S2 for both (#5), serial stage | 118.7 [121.1, 116.3] (2.44) | 150.3 | 31.8 | 699 [699, 699] | no (speed) |
| 3. HEAD with `LP_ML_PIPELINE=0 LP_SCAN_CONCURRENCY=1` | 114.3 [114.9, 113.7] (2.54) | 142.1 | 30.7 | 698 [696, 701] | no (speed) |
| **4. HEAD default** (MobileCLIP-S2 both, scan concurrency 4, pipelined ML jobs, shared ORT arena, faces at 640, squares Q80) | **64.9** [65.0, 64.8] (**4.47**) | **135.4** | 30.5 | **753** [753, 753] | **yes** |
| 5. HEAD + `LP_ORT_CPU_ARENA=0` | 65.5 [66.1, 64.8] (4.43) | 138.9 | 31.0 | **704** [712, 697] | yes (least RAM) |
| 6. HEAD + `LP_ORT_CPU_ARENA=1` (per-session arenas) | 64.9 [65.0, 64.8] (4.47) | **132.0** | 30.9 | 1,480 [1,482, 1,479] | no (RAM) |
| 7. HEAD + `LP_FACE_DET_SIZE=auto` | **62.1** [61.5, 62.7] (**4.67**) | 135.5 | 30.5 | 745 [734, 755] | yes (fastest; -9% face recall on the goldens, #6) |
| 8. HEAD + `SEMANTIC_SEARCH_MODEL=clip_vit_b32` | 83.8 [83.8, 83.8] (3.46) | 136.1 | 31.0 | 1,327 [1,333, 1,321] | no |
| (#11) mimalloc, at #10 | 66.0 (4.39) | 143.0 | 30.5 | 861 | yes, dominated |
| (#13) HEAD + `LP_OCR_PREPASS=640` (at #13) | 65.0 (4.46) | 157.4 | 30.5 | 750 | yes; OCR slower on this text-heavy corpus |

**Target met by the default: 4.47 photos/s (290 photos in 64.9 s) with a 753 MB whole-run peak**
(other sessions of the same configuration: 4.40-4.48 photos/s, 725-816 MB). Pareto front on
(scan speed, peak): `LP_ORT_CPU_ARENA=0` (704 MB, OCR +2.6%), the default, `LP_FACE_DET_SIZE=auto`
(4.67/s) for speed when small faces matter less, `LP_ORT_CPU_ARENA=1` for the fastest OCR (-2.5%)
at twice the RAM. The default keeps 640 face detection (recall) and the shared arena (OCR 2.6%
faster than no arena for +50 MB). The stage uses 243 CPU-s on 4 cores (3.8 busy), so what is left
is per-photo CPU work: MobileCLIP 37 s (110 ms/photo at 4 threads), scan 16.5 s, faces 11.5 s.
Next candidates: an arm64 int8 check (dot-product kernels, #7), the OCR prepass on a real library
(#13), tags + faces on 2 threads each in one merged pass (#8 note, ~+20% on ORT efficiency),
and OCR on the big thumbnail instead of multi-megapixel originals (decode + det at 1080 instead
of 1600 px; needs a recall check on small text).

## Round 3 (target: ML-on scan >= 40 photos/s, whole tree <= 4 GB RAM)

Workflow: `rust-pg/workflows/opt_round3_scaling.md`. The Pi pin is lifted: Ryzen 5 2600X (6C/12T),
32 GB, **GeForce GTX 1660 Ti 6 GB** (Turing, driver 591.86, WDDM).

**Benchmark (W4 ML-on scan).** `ml_footprint.py --cpus all --threads N [--gpu-ort dml|cuda]
scan rs --lib w4 --scan-only` (new flags): the W4 library (`rust-pg/bench-scan/lib`, 2,025 generated
files: 2,000 phone JPEGs, mostly 12 MP, 20 PNGs, 5 videos; no faces), a fresh `lp_fixture` clone, ML
on at the default models (MobileCLIP-S2 tags + search embedding, buffalo_sc faces at 640), nothing
pinned, one worker. Metric = photos / wall seconds of scan + tags + CLIP + faces (the scan stage of
`ml_footprint.py`), CPU-s of the tree over the stage, peak working set of the whole tree over the
run, GPU memory (`--gpu-ort`: the server's dedicated GPU memory from the Windows `GPU Process
Memory` counter from #17 on; nvidia-smi's total minus its pre-run median for #16, noisy by
+-250 MiB because the desktop shares the GPU) and GPU utilisation (nvidia-smi). Summaries:
`round3_summary.py results/2026-10-05-round3/*.json`; raw files in `results/2026-10-05-round3/`.
OCR and captions are separate jobs and reported separately.

GPU runtimes (scratch venvs under `rust-pg/gpu`, nothing system-wide): `onnxruntime-directml`
1.24.4 (wheel ~25 MB; installed `onnxruntime.dll` 21 MB + `DirectML.dll` 18.5 MB, 73 MB package);
`onnxruntime-gpu` 1.27.0 (wheel 214 MB, 277 MB installed) + `nvidia-cuda-runtime` / `-nvrtc` 13.4,
`nvidia-cublas` 13.8, `nvidia-cufft` 12.4, `nvidia-curand` 10.4 (923 MB installed together) +
`nvidia-cudnn-cu13` (9.27: 599 MB; 9.13: 402 MB). ORT 1.27's CUDA build targets CUDA **13**
(`nvidia-*-cu13`), not 12.

### Scaling table

| config | photos/s | peak RSS MB | peak VRAM MiB | CPU-s | notes |
|---|---:|---:|---:|---:|---|
| R2 default, 4 pinned cores (290-photo corpus, for reference) | 4.47 | 753 | - | 243 | round 2 Pareto row 4 |
| B0: CPU, 12 intra-op threads, unpinned | <= 4.22 (cut at 480 s) | 1,039 | - | 3,997 | tags at ~200 ms/photo: 12 ORT threads oversubscribe the 6 cores next to the decoders |
| B0': CPU, 6 intra-op threads | 4.40 [4.40, <= 4.05] | 920 | - | 2,576 | scan 146 s, tags 252 s, faces 61 s, strictly in sequence |
| #16 DirectML | 7.92 [8.10, 7.74] | 775 | 267-329 | 725 | scan 131 s (14.6 photos/s on ~5 cores: 4 groups at once), tags 71 s, faces 48 s |
| #16 CUDA (cuDNN 9.13) | 7.45 (1 run) | 1,049 | 837 | 800 | CUDA/cuDNN DLLs: +300 MB working set, 2.3 GB private |
| #17 DirectML + batched MobileCLIP (32/16) | 6.39 [6.33, 6.44] (same session: batch off 4.35 [4.69, <= 4.04]) | 810 | 1,483-1,748 | 890 | the tags job's album writes dominate and swing 69-275 s between sessions (#18) |
| #18 + batched tag writes (64 per transaction) | 7.74 [7.90, 7.58] (same session: per photo 7.13) | 852 | 1,483 | 829 | tags job 51 s (~40/s); scan job 151-169 s now the long pole, the three jobs still run one after another |
| #19 + ML inside the scan (pixels) | 12.97 [12.93, 13.01] (same session: follow-ups 8.63 [8.52, 8.74]) | 1,236 | 1,650 | 766 | scan job 154 s holds everything; tags/faces follow-ups < 1 s; the scan job itself is now the whole stage |
| #20 inline ML from the decoded WebP (default) | 12.14 [11.89, 12.14, 12.63] (same session: pixels 12.08 [13.23, 12.08, 11.93]) | 1,216 | 1,652-1,970 | 783 | exact ML parity with the follow-up jobs; this session ran ~7% slower than #19's (GPU clocks / disk, same binary) |
| #21 scan concurrency 8, libvips 1 thread per operation | 16.21 [16.19, 16.23] (same session: 4 groups 11.71 [11.49, 11.93]) | 1,172 | 1,642-1,672 | 774 | the box is CPU-bound now: 97% busy (typeperf), of which the scan tree ~58%, the rest Postgres, Defender + Search indexer on the new thumbnails, the browser, the samplers |
| #24 videos first (default; 8 groups) | 15.98 [15.94, 16.02] (same session: walk order 14.59 [14.21, 14.96]) | 1,341 | 370-675 | 745 | 99% system CPU; 12 groups slower again (14.59) |

### Notes

**16. GPU execution provider.** Offline first (`bench/gpu_micro.py`, random input, ms per
image at batch 1 / 16 / 64): MobileCLIP-S2 image tower CPU (12 threads) 117 / 149 / 108, DirectML
19.5 / 16.1 / 9.2, CUDA with cuDNN 9.27 **570** / 38 / 17.7, CUDA with cuDNN 9.13 19.9 / 9.1 / 8.7;
SCRFD-500M at 640: CPU 18.3, DirectML 6.8, CUDA 8.1; ArcFace: CPU 17.8 / 12.6, DirectML 1.8, CUDA
3.6 / 0.9 / 0.75. The cuDNN 9.27 number is a cuDNN regression on Turing: ORT's profiler puts 95% of
a run in the four `convffn` depthwise convolutions of the last MCi2 stage (~160 ms each), with every
`cudnn_conv_algo_search` setting; `prefer_nhwc` brings it to 141 ms; cuDNN 9.13.0 runs them
normally. **A CUDA image must pin cuDNN (9.13 works on Turing; newer ones need a check per GPU
generation).** In the scan, DirectML and CUDA land within noise of each other; DirectML is the one
that needs nothing but the 40 MB runtime on Windows, CUDA is what a Linux/Docker GPU image would
ship (+1.6 GB of libraries, +300 MB working set, ~2.3 GB committed by the CUDA context).

With the models on the GPU the stage no longer waits for inference: tags went from 252 s to 71 s,
but the GPU is only 15-25% busy. What is left is sequential CPU work: the scan job (131-137 s,
14.6-15.5 photos/s, ~5 of 12 hardware threads busy because only 4 file groups render at once),
then the tags job (decode the 1080 px WebP + Pillow-exact resize to 256 + one DB transaction per
photo, 4 photos in flight), then the face job (an ExifTool XMP-region round trip + decode +
detection per photo, 3 ahead). The three jobs run strictly one after another (the scan chains
tags -> CLIP -> faces). 12 intra-op threads on the CPU provider are slower than 6 (oversubscription),
so the CPU fallback keeps `ONNX_INTRA_OP_THREADS` at the physical core count.

Parity on the GPU (DirectML, the Python CPU goldens, `cargo test -p lp-ml --test tags --test face`
with `LP_ORT_LIB` = the DirectML runtime and `ONNX_PROVIDERS=dml`): MobileCLIP 82/82 identical tag
sets and order on the same pixels, max score difference 6.8e-6 (CPU: 4.2e-6), image embedding cosine
1.000000; faces: all 12 golden tests pass (5 packs, e2e thumbnails, encodings, odd inputs), the same
faces and order, boxes as on CPU (min IoU 0.9984, max box diff 0.145 px, the JPEG decoder's share),
embeddings of the same crop at cosine >= 0.999999998 (CPU: bit-identical).

**17. Batched inference.** The tags job prepares photos on blocking threads and queues them; one
caller at a time leads the queue and runs it through the image tower in batches (`batch::submit`).
A first version let every caller take the model slot in turn: callers whose result had already been
sent still queued for the slot, and each ran whatever had arrived meanwhile as a tiny batch; with
128 photos in flight it was 3x slower than no batching (V 415.9 s, tags 222 s) and in another run
the 128 concurrent photo transactions exhausted the database pool (`pool timed out`, the tags job
failed). The leader version, plus at most a few concurrent tag-store transactions, gives the row
above. DirectML runs small batches badly (b2 64 ms, b4 45 ms per image vs b1 20 ms), so groups under
16 run one by one, and it keeps the activations of the largest batch resident (b64: 2.6 GB VRAM,
b32: 1.5 GB; the default is 32). The GPU's clock drops to 650-765 MHz between bursts (P-state power
saving; locking clocks is a system setting, not done), one more source of the run-to-run spread.
The real limit of the tags job shows in its log: photos are stored in bursts of 10-33 per second.
Every photo locks its tags' `AlbumThing` rows (`FOR UPDATE`, id order) and recounts them
(`photo_count` = a scan of the album's memberships, covers = a window over them), so on a fresh
library the popular albums grow to thousands of photos, every photo pays O(album size) per tag and
the photos queue behind each other's locks; how fast depends on when autovacuum analyzes the
fresh tables. That is #18.

**18. Batched tag writes.** With #17 the tags job still wrote one transaction per photo: lock the
photo's tag albums, recount each (a scan of its memberships joined to `api_photo`), top up covers (a
window over the memberships). On a fresh 2,000-photo library the popular tag albums grow to
thousands of photos, so each photo cost O(album size) per tag while holding the album locks other
photos needed. Now one writer at a time stores what has queued (up to 64 photos): the same
statements over arrays, and `things::replace_thing_memberships_many` locks and refreshes the union
of the touched albums once. Memberships are inserted photo by photo in the order the photos were
tagged, so covers (the first four memberships by id) follow the same rule as before. The queue is
per database (host, port, name) because one process can serve several (the test binaries do).

**19. ML inside the scan.** The hook (`lp_ingest::inline` + `lp_tasks::inline_ml`) runs per photo
after the scan wrote its rows: tags + search embedding (`tags::store_tags`, batched writes of #18)
and faces (XMP regions, else SCRFD + ArcFace on the same pixels; `lp_photo_faces_scanned` marks the
photo so the `faces.scan` follow-up skips it). In-flight photos are bounded by the batch policy
(64 on DirectML), so batches of 32 fill while the scan renders the next files, and the scan waits
for the last ones before it queues the follow-ups. **What the user sees:** the scan job's progress
bar now covers tags, embeddings and faces too (it reaches its file count, then waits for the
last batch to be stored); "Generate tags", "Calculate CLIP embeddings" and "Scan faces"
still appear in the job list and finish within a second (nothing left for them; they still embed
videos, retry failures and rebuild the similarity index). Without a GPU the follow-ups run as
before (`auto`): on the CPU the models would compete with the scan for the same cores and the Pi
profile is untouched. Wall time is now the scan job alone (154 s, 13 photos/s); ML adds no wall
time, so the next levers are the scan's own CPU work and parallelism.

**20. Decode once.** Per photo (`examples/scan_costs.rs`, one thread, 50 W4 photos): libvips
thumbnail (12 MP JPEG, shrink-on-load) 59 ms, big WebP Q95 effort 2 67.6 ms, squares 23.5 ms, pHash
26 ms (of which WebP decode 17.7), dominant colour 2.6, MD5 3.6; the follow-ups decoded the big WebP
twice more (tags, faces: 2 x ~18 ms + resizes). The scan already decodes the WebP for the pHash,
so that decode now also feeds the models: the ML inputs are bit-identical to the follow-ups'
(libwebp and the `image` crate decode the same pixels, 50/50; parity run identical to six
digits). libvips' pre-encode pixels would save nothing more and drift: the models then see
the image without the Q95 loss, which moves a quarter of the tag sets (low-probability tail,
top-1 agrees on 98%) and face boxes by up to 3% IoU, against what Django and the follow-ups
produce. A first measurement of this step ran an old binary (`cargo build -p lp-server
--example x` builds only the example), so all four runs were `pixels`; they are kept as #19
replicates (`s19_V_r3..6`).

**21. Concurrency and where the time goes.** Per-stage timers (`LP_SCAN_TIMERS=1`, 8 groups,
vips 1; wall ms per photo, summed over concurrent photos): render 359 (decode + resize 145, big
WebP 121, squares 43), pHash + colour 50, MD5 probe 8, motion-photo scan 4, file/group/photo DB
work ~17, metadata ExifTool call 16 (overlaps the render), inline back-pressure 22; in the inline
ML: tags 1.9 s (prepare + wait for a batch of 32), tag store 0.2 s, faces 63 ms detect + 12 ms XMP
region read (a second ExifTool round trip per photo). Every image step takes 2-2.5x its
single-thread time (`scan_costs`: decode 59, WebP 68, squares 24 ms): the CPU is saturated. A
whole-system sample over one run (184 s x 12 threads = 2,209 CPU-s): librephotos-rs 793,
idle 486, browser 159, Postgres 100, Defender 96, the benchmark's own psutil samplers 75, kernel
42, ExifTool 41, Search indexer 59 (indexer + protocol host; both react to the 6,000 new thumbnail
files), terminal/dwm/svchost ~85. Defender and the indexer are this desktop's cost of writing
files (a Linux server has neither; excluding the folder is a system setting, not changed). So
past 8 groups more concurrency only adds contention; what is left is doing less CPU work per
photo (#22+).

**22-24. Where the CPU goes, and what is Windows-specific.** Earlier sessions of the same
configuration (#21: 16.2/s) and #22 (15.6/s) differ by the run-to-run spread of this desktop.
#22's effort 0 cut 8% of the scan's CPU-s without a speed gain because the scan then still ended
with the video tail (#24); with the tail gone the box is 99% busy. The image work alone
(`scan_costs` with `THREADS=n`: MD5, motion scan, libvips thumbnail, big WebP to a new file,
squares, pHash + RGB from the WebP, colour, ML tensors; no DB, ExifTool or models; 400 W4 photos)
scales to **29.2 photos/s on 12 threads** (1: 4.62, 4: 15.8, 6: 20.5, 8: 25.8; 9.3 threads busy at
12) and is the hard ceiling of this pipeline on this CPU. The full scan with ML off
(`FEATURE_SCENE_CLASSIFICATION=0 FEATURE_FACE_DETECTION=0`, walk order) ran its scan job at 18.5/s
with 8 and with 12 groups (the video tail again). CPU per photo in a default run (#24, typeperf
per process and the per-executable split, 2,025 photos): librephotos-rs **~365 ms** (decode,
WebP, pHash, the inline ML's tensors and GPU calls, DB client), Postgres **~48 ms** (24 s of its 97
CPU-s without ML: the inline ML's per-photo rows and the tag-store batches, #25), ExifTool ~21 ms,
ffmpeg ~5 ms; and outside the tree, caused by the scan writing 6,000 thumbnail files: **Windows
Defender real-time scanning ~44 ms** (MsMpEng 89-96 CPU-s per run) and the **Search indexer ~30-36
ms** (SearchIndexer + ProtocolHost + FilterHost 59-72 CPU-s), plus kernel/System ~14-20 ms. Of the
~520 ms of CPU the box spends per photo, ~80-90 ms (16%) is Defender and the indexer, which a
Linux server does not run (the desktop's browser, terminal and the benchmark's samplers took
another ~100 CPU-s per run). Defender settings and exclusions were not touched.
