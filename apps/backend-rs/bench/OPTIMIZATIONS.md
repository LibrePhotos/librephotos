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
