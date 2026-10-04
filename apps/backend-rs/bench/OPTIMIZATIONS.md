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
- Switching: ViT-B/32 embeddings have magnitude ~9-12, MobileCLIP ~0.9-1.2, so
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
