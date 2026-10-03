# ML footprint: one Rust process vs Django + sidecars (2026-10-03)

Can the whole backend, ML included, run as one small process on a Raspberry Pi?
Measured on `experiment/rust-backend` (fc721c170 code, release build), raw data in
`results/2026-10-03-ml-footprint/` (summary: `ML_FOOTPRINT.json`).

Machine: Ryzen 5 2600X, 32 GB, Windows 11, Postgres 16 on the same box (fsync off).
To look like a Pi, the backend's whole process tree is pinned to **4 logical CPUs, one
per physical core** (0, 2, 4, 6) with `ONNX_INTRA_OP_THREADS=4`; Postgres runs on
CPUs 8-11. Both sides use the same ONNX Runtime build (1.27.0, the Django venv's DLL,
loaded by Rust through `ort` load-dynamic) and the same model files.
Default models: CLIP ViT-B/32 (semantic search), MobileCLIP-S2 (tags), buffalo_sc
(faces), LFM2-VL-450M q4 (captions); OCR is off by default, so `ppocrv6_small` is
switched on. Reverse geocoding off (network).
RSS = working set, private = private bytes (committed), summed over the process tree,
sampled every 0.25-0.5 s, in MiB (file sizes in 10^6 bytes).

## Summary

- **Binary: 49.3 MB** as shipped (lto thin, cgu 1), **21.6 MB** smallest
  (`opt-level="z"`, fat LTO, cgu 1, `panic="abort"`, strip); `panic="abort"` alone
  -29%, `opt-level="z"` alone -32%. `opt-level="z"` costs throughput (see 1.1).
- **Image: ~190-215 MB compressed** (debian:trixie-slim + binary + ONNX Runtime +
  libvips + exiftool/perl + ffmpeg libs) vs **572 MB** amd64 / **531 MB** arm64 for
  today's `reallibrephotos/librephotos`; ~80-110 MB without ffmpeg (no video).
  The default models add ~1.4 GB on disk to either, downloaded at runtime as today.
- **Idle: 15 MB.** Every default model loaded at once: **2.1 GB** (ORT CPU arena on,
  the default) or **1.24 GB** with `LP_ORT_CPU_ARENA=0`. After the 120 s idle unload:
  **144 MB**. Django + 8 sidecars sit at **1.44 GB idle** before any model loads.
- **ML-on scan of 290 photos, one worker: Rust 2.0 files/s at 1.8 GB peak, Django +
  sidecars 1.0 files/s at 4.1-4.3 GB peak** (36 processes; 12 GB committed).
  Arena off: 1.32 GB peak, speed within run-to-run noise (one run). More workers do
  not help on 4 cores.
- **Pi verdict:** Pi 4/5 with 4 GB runs everything, captions included, in one process
  (arena off); 8 GB is comfortable. 2 GB runs faces, tags, OCR and CLIP search with the
  arena off and captions off. 1 GB: photos, thumbnails, faces only. Django + sidecars
  need the 8 GB model. Expect roughly 0.4x (Pi 5) / 0.2x (Pi 4) of the throughput below.

## 1. Sizes

### 1.1 `librephotos-rs` binary (Windows x64 MSVC; `results/.../sizes.json`)

Each variant = the release profile plus one change, a full build capped at 10 min
(`CARGO_BUILD_JOBS=6`). MSVC keeps debug info in a separate PDB (8.6 MB), so `strip`
barely matters here; on Linux it removes the symbol table.

| variant | profile change | build | exe | gzip | vs as-is |
|---|---|---:|---:|---:|---:|
| **as-is** | `lto = "thin"`, `codegen-units = 1` | 12.7 min (4 jobs) | **49.3 MB** | 18.7 MB | |
| strip | `strip = true` | 8.9 min | 49.3 MB | 18.7 MB | 0% (PDB is separate on MSVC) |
| fat LTO | `lto = "fat"` | > 10 min, stopped | - | - | - |
| opt s | `opt-level = "s"` | 6.5 min | 36.3 MB | 13.6 MB | -26% |
| panic abort | `panic = "abort"` | 8.4 min | 34.9 MB | 15.1 MB | -29% |
| opt z | `opt-level = "z"` | 6.4 min | 33.5 MB | 12.7 MB | -32% |
| **smallest** | z + fat LTO + `panic = "abort"` + strip | 9.1 min | **21.6 MB** | 9.9 MB | **-56%** |

gzip -6 of the as-is binary (what a Docker layer costs): 18.7 MB; smallest: 9.9 MB.

Throughput of the smallest variant vs as-is (`quick.py`, 50k library, c=32, 4 s per cell,
server on 6 CPUs, two alternating runs each, req/s):

| endpoint | as-is | smallest | delta |
|---|---:|---:|---:|
| timeline day page (`date_page_1`) | 1,480 / 1,631 | 1,486 / 1,695 | +2% (Postgres-bound) |
| photo detail | 3,026 / 2,968 | 2,203 / 2,598 | **-18%** |
| site settings | 4,656 / 4,656 | 5,721 / 6,697 | +33% |

ML-on scan with the smallest binary (one run): 1.53 files/s vs 2.0 (as-is median), OCR
199 s vs 148 s. `opt-level="z"` slows the pure-Rust pixel work (preprocessing, pHash,
tokenizing); ONNX Runtime and libvips are external libraries and unaffected. For a Pi
image, `strip = true` (Linux) and `panic = "abort"` (-29% on its own: unwind tables and
landing pads go; not benchmarked alone, usually free at runtime) are the size wins worth
taking; `opt-level` should stay 3. But `panic = "abort"` turns a panicking request
handler or job into a process exit (today tokio and the job worker catch it), so it
needs a supervisor (Docker restart policy) and is a behaviour change, not a free flag.

Linux binaries were not built (no Linux toolchain or Docker on this box; see 4.3). A
stripped Linux x86_64/aarch64 build of the same code is typically within ±20% of the
MSVC exe; assume ~45-55 MB as-is, ~20-25 MB smallest.

### 1.2 Runtime dependencies

| | Linux x64 | Linux arm64 | source |
|---|---:|---:|---|
| ONNX Runtime 1.27.0 `libonnxruntime.so` | 23.7 MB (tgz 8.8) | 20.0 MB (tgz 7.8) | PyPI wheel contents; GitHub release assets |
| libvips, Debian `libvips42t64` + deps | 126 MB installed, 40 MB debs (121 pkgs) | 131 MB, 37 MB | trixie Packages index, no recommends |
| libvips, pyvips-binary (self-contained .so) | 18.5 MB (wheel 8.1) | 18.2 MB (wheel 8.2) | PyPI; no HEVC-HEIC decoder (see caveats) |
| exiftool + perl (Debian) | 76 MB installed, 13.5 MB debs | 78 MB, 13.3 MB | `libimage-exiftool-perl` closure |
| ffmpeg, `ffmpeg-bin` wheel libs (today's image) | 201 MB (wheel 80.6) | 153 MB (wheel 71.5) | GitHub release of the project |
| ffmpeg, Debian `ffmpeg` | 445 MB installed, 133 MB debs (207 pkgs: mesa, LLVM) | 410 MB, 121 MB | avoid |
| ffmpeg, BtbN n8.1 static LGPL / shared LGPL (tar.xz) | 137 / 66 MB | 116 / 56 MB | GitHub release assets |
| Windows (this box): onnxruntime.dll / libvips dll / exiftool dir / ffmpeg dir | 17.3 / 18.6 / 34.6 / 189 MB | | Django venv |

Models on disk (`protected_media/data_models`):

| model | MB | default? |
|---|---:|---|
| clip_vit_b32 (text + vision, fp32) | 608 | semantic search |
| mobileclip_s2 (vision 143 + text 254 + tag embeddings) | 401 | tags (text tower only builds a missing tag cache) |
| buffalo_sc / buffalo_s / buffalo_m / buffalo_l / antelopev2 | 16 / 166 / 328 / 341 / 428 | buffalo_sc |
| lfm2_vl_450m (q4) | 368 | captions |
| ppocrv6 tiny / small / medium | 6 / 31 / 139 | off (small measured) |
| siglip2 (alternative tagger) | 1,510 | no |

Default set: **1,393 MB** (+31 MB with OCR small). ONNX weights barely compress.

### 1.3 Docker image estimate (compressed, MB)

Current images (Docker Hub, tag 1.2.1, amd64 / arm64): `reallibrephotos/librephotos`
(backend) **572.0 / 530.5** (501 / 461 of it is the `pip install` layer),
`librephotos-unified` 575.5 / 533.9, `librephotos-gpu` 2,960.8 (amd64 only),
`librephotos-frontend` 6.1 / 5.9, `librephotos-proxy` 63.2 / 61.5.

Rust backend image on `debian:trixie-slim` (29.8 / 30.2):

| layer | amd64 | arm64 |
|---|---:|---:|
| debian:trixie-slim | 29.8 | 30.2 |
| librephotos-rs (gzip of the as-is binary; arm64 assumed equal) | 18.7 | ~18.7 |
| ONNX Runtime (official tgz) | 8.8 | 7.8 |
| libvips (apt closure, debs) | 40.2 | 36.6 |
| exiftool + perl (apt) | 13.5 | 13.3 |
| ca-certificates | 1.7 | 1.6 |
| ffmpeg (ffmpeg-bin libs, as today) | 80.6 | 71.5 |
| **total** | **~193** | **~180** |
| without ffmpeg (no video thumbnails/transcodes) | ~113 | ~108 |
| without ffmpeg, libvips from pyvips-binary | ~81 | ~80 |
| + frontend (unified image, Rust serving the SPA) | +6 | +6 |

Debian debs are xz, Docker layers gzip: add ~10-20% to the apt rows, so **~190-215 MB**
vs 572 MB today (about 1/3). With the default models baked in (today they are
downloaded at runtime into `data_models`, unchanged for Rust): **+~1.3 GB**, i.e.
~1.5 GB Rust vs ~1.9 GB Django. `gcr.io/distroless/cc-debian12` (9.2 / 9.0 MB) is too
bare: libvips alone pulls 121 Debian packages, so debian-slim is the realistic base.

## 2. Memory, one process (`WORKER_CONCURRENCY=1`, every ML feature on)

### 2.1 Cost per model (fresh process each, 6 photos, every other ML step off)

Delta over the same process after a scan with no model (~66 MB RSS: runtime, ExifTool
pool, thumbnails), then the service triggered once:

| model | on disk | RSS, arena on | RSS, arena off | peak, on / off |
|---|---:|---:|---:|---:|
| CLIP ViT-B/32 (text + image, one slot) | 608 MB | +632 MB | +623 MB | 706 / 697 |
| tags, MobileCLIP-S2 vision | 145 MB used | +196 MB | +176 MB | 333 / 258 |
| faces, buffalo_sc (+ clustering) | 16 MB | +120 MB | +86 MB | 191 / 158 |
| OCR, ppocrv6_small | 31 MB | **+467 MB** | **+63 MB** | 565 / 286 |
| caption, LFM2-VL-450M q4 | 368 MB | +539 MB | +327 MB | 611 / 435 |

ONNX Runtime's CPU arena never returns memory and grows to the largest input it has
seen: OCR on a 1240x1754 document page keeps ~400 MB of arena for a 31 MB model.
`LP_ORT_CPU_ARENA=0` drops that; the time cost on this run was small (OCR 6 photos 8.0 s
vs 5.7 s incl. load; caption 5.7 s both; full scan below: within run-to-run noise).

### 2.2 All models in one process (`models.json`, `models_na.json`)

| step | RSS arena on | private | RSS arena off | private |
|---|---:|---:|---:|---:|
| idle, no model loaded | **15.2** | 3.5 | 15.2 | 3.5 |
| + CLIP (semantic search) | 642 | 622 | 641 | 621 |
| + scan with tags | 848 | 813 | 726 | 691 |
| + CLIP image embeddings, faces | 965 | 939 | 861 | 814 |
| + OCR | 1,422 | 1,643 | 939 | 890 |
| + caption | 1,934 | 2,216 | 1,238 | 1,128 |
| **all models loaded** (every service used within 120 s) | **2,128** | 2,547 | **1,239** | 1,128 |
| peak | 2,133 | 2,553 | 1,440 | 1,330 |
| **after the 120 s idle unload** | **144** | 93 | **145** | 96 |

The unload works (all five slots empty again); the remaining ~130 MB over idle is
presumably the loaded ONNX Runtime library, its thread pools and heap fragmentation.

## 3. ML-on scan: throughput and peak memory

Library: 290 photos (299 files: 66 E2E-ML photos with faces/documents/scenes, the
fixture's JPEG/PNG/HEIC/DNG/MP4/XMP originals, deploy/e2e, 194 generated phone JPEGs).
Sequence: scan (+ tags, CLIP, faces follow-ups) -> train faces -> OCR full scan -> 10
captions on demand. files/s = photos / wall time of the scan stage with its ML
follow-ups. Each run <= 10 min.

| backend | runs | scan+tags+CLIP+faces | files/s | OCR (289) | 10 captions | peak RSS | peak private |
|---|---|---:|---:|---:|---:|---:|---:|
| **Rust, 1 worker** | 3 | **142 / 202 / 144 s** | **2.0** (1.4) | 149 / 230 / 148 s | 33 / 45 / 31 s | **1,840 / 1,798 / 1,819 MB** | 1.89 GB |
| Rust, 1 worker, arena off | 1 | 168 s | 1.73 | 167 s | 34 s | **1,323 MB** | 1.27 GB |
| Rust, 2 workers | 2 | 141 / 189 s | 2.05 / 1.54 | 162 / 203 s | 39 s | 1,858 / 1,811 MB | 1.92 GB |
| Rust, 4 workers | 2 | 143 / 166 s | 2.03 / 1.74 | 160 / 192 s | 36 s | 1,958 / 1,870 MB | 1.98 GB |
| Rust, 1 worker, smallest binary | 1 | 189 s | 1.53 | 199 s | 31 s | 1,784 MB | 1.89 GB |
| **Django + 8 sidecars, 1 worker** | 3 | **290 / 268 / 310 s** | **1.0** (0.9-1.1) | 185 / 161 / 173 s | 35 / 32 s | **4,284 / 4,283 / 4,058 MB** | **12.4 GB** |

Runs are listed in time order (the first of each row from 2026-09-30, same binary and
script). The 202 s Rust run is an outlier with the user's browser busy on the pinned
CPUs (~15-25% background load per CPU during this session); medians: **Rust 144 s,
Django 290 s, 2.0x**. Both finish every step with matching counts (faces 51, all 51
clustered) except the HEIC sample (CLIP/tags 289 vs 290, OCR 288 vs 289; see caveats).

Per job (Rust median run vs Django median run, seconds): scan 53 vs 108, tags 45 vs
172, CLIP 20 vs 31, faces 25 vs 46; OCR medians 149 vs 173. Captions are on par (3-4.5 s each,
same ORT, same model).

Where Django's memory goes (idle, before any model): qcluster 587 MB, uvicorn 209 MB,
eight sidecars 60-88 MB each = **1.44 GB**; at peak: qcluster 837, CLIP sidecar 792,
OCR sidecar 799, caption sidecar 615-835, tags 270, faces 245-251, exif 135.

**Workers:** the scan job itself scales (65 -> 39 -> 25 s for 1/2/4 workers), but tags,
CLIP and faces are one batch job each; with more workers they run side by side, each
ORT session using 4 intra-op threads on the same 4 cores, so each takes 2-3x longer and
the stage wall time stays flat (141-143 s on 2026-09-30, 166-202 s today). OCR is one
job. Peak RSS grows ~50-120 MB per extra worker. On a 4-core box, one worker is right.

## 4. Raspberry Pi verdict

### 4.1 Memory budget

Linux RSS will not match Windows working set exactly (glibc vs the Windows heap, ORT's
allocator is the same); take ±20%. Next to the backend a Pi needs the OS (~150-250 MB,
Raspberry Pi OS Lite 64-bit) and Postgres (~100-250 MB with default shared_buffers),
plus the frontend/proxy (nginx: a few MB).

| Rust backend profile | peak RSS (measured) |
|---|---:|
| API + scan, ML off | ~65 MB (+ ExifTool's perl) |
| + faces (buffalo_sc), arena off | ~150 MB |
| + tags + OCR small, arena off | ~400 MB |
| + CLIP search, arena off (no captions) | ~0.95-1.0 GB |
| everything incl. captions, arena off | 1.24-1.44 GB (scan peak 1.32 GB) |
| everything, arena on (default) | 1.8-2.1 GB |
| Django + uvicorn + qcluster + 8 sidecars | 1.44 GB idle, 4.1-4.3 GB peak |

| board | Rust, one process | Django + sidecars |
|---|---|---|
| Pi Zero 2 W / Pi 3 (512 MB-1 GB) | API + scan with ML off; faces only on 1 GB | no |
| Pi 4 / Pi 5 **1 GB** | ML off, or faces only (arena off) | no |
| Pi 4 / Pi 5 **2 GB** | faces + tags + OCR + CLIP search, captions off, `LP_ORT_CPU_ARENA=0`, 1 worker; tight (~1.0 GB + OS + Postgres = ~1.5 GB) | no |
| Pi 4 / Pi 5 **4 GB** | **everything incl. captions**, arena off (1.3-1.4 GB peak); arena on (2.1 GB) also fits | no (idle 1.4 GB + Postgres + OS, ML peak 4.3 GB) |
| Pi 4 / Pi 5 **8 GB**, Pi 5 16 GB | everything, arena on, room for siglip2 or buffalo_l | yes, ~4.3 GB peak |

Worker count: `WORKER_CONCURRENCY=1` on any Pi (4 cores; extra workers only add memory).
`LP_ML_IDLE_UNLOAD_SECS` keeps a Pi at ~150 MB between scans.

### 4.2 Speed (estimate, not measured on a Pi)

Assumption: ONNX Runtime's MLAS kernels on Cortex-A76 (Pi 5, 2.4 GHz, NEON) reach
~40-50% of a Zen+ core at ~3.9 GHz (both issue two 128-bit FMAs per cycle; the clock and
the Pi's ~17 GB/s LPDDR4X make up the rest), Cortex-A72 (Pi 4, 1.8 GHz) ~15-25%.
Measured here on 4 cores: 2.0 files/s ML-on, OCR ~0.5 s/photo, captions ~3.5 s each.

| | Pi 5 (~0.4x) | Pi 4 (~0.2x) |
|---|---:|---:|
| ML-on scan (tags, CLIP, faces) | ~0.8 files/s, ~2,900 photos/h | ~0.4 files/s, ~1,400 photos/h |
| + OCR (small) | ~1.2 s/photo | ~2.5 s/photo |
| caption | ~9 s/photo | ~18 s/photo |
| ML off (scan, thumbnails, pHash) | the RESULTS.md ML-off rate (15.7 files/s on 6 x86 cores) scaled to 4 cores the same way: ~3-4 files/s | ~1.5-2 files/s |

A 20,000-photo library: ~7 h of ML on a Pi 5, ~14 h on a Pi 4, once; afterwards only
new photos. Django on the same board runs at half the Rust rate where it fits at all.

### 4.3 arm64 caveats

- **ONNX Runtime arm64:** official `onnxruntime-linux-aarch64-1.27.0.tgz` (7.8 MB,
  20 MB .so) and the manylinux aarch64 wheel exist; Rust loads it with `LP_ORT_LIB` or
  from next to the binary. The q4 caption model uses `MatMulNBits`, which has NEON /
  dot-product kernels on arm64 (A76 has dotprod, no i8mm). Not run on arm64 here.
- **libvips:** Debian's arm64 `libvips42t64` is the same package set (131 MB installed).
- **exiftool:** perl, architecture-independent. **ffmpeg:** arm64 wheel libs 153 MB,
  or a minimal custom build for thumbnails only.
- **Cross-compiling** `aarch64-unknown-linux-gnu` was not attempted: the box has only
  the `x86_64-pc-windows-msvc` target, no WSL distribution and no working Docker, and the
  C dependencies (libwebp-sys, zstd, ...) need an aarch64 sysroot (cargo-zigbuild or
  `cross` would install a toolchain). The code has no x86-only parts: TLS is rustls,
  ONNX Runtime and libvips are loaded at runtime, so an arm64 build should only need
  the target and a linker.

## Caveats

- Windows, not a Pi and not Linux containers. Throughput on the Pi is an estimate.
- Background load from the user's desktop (browser) on the pinned CPUs made Rust runs
  vary 142-202 s; Django varied 268-310 s. Medians of three are used.
- **HEIC:** the Windows libvips (pyvips-binary, built from sharp-libvips) has no HEVC
  decoder, so the Rust scan cannot thumbnail `sample.heic` (Django falls back to
  pillow-heif). Debian's libvips + `libheif-plugin-libde265` would decode it; with the
  pyvips-binary .so in an image the same gap remains.
- `private` on Windows is committed memory; Django's 12.4 GB private vs 4.3 GB RSS is
  commit reserved by 36 Python processes (Linux overcommits; RSS is the number that matters
  for a Pi).
- One captioning model, one OCR model, the default face pack. buffalo_l (341 MB) or
  siglip2 (1.5 GB) cost proportionally more.
- Binary variants were built for Windows MSVC only; Linux sizes are estimates.
- The library is 290 photos; the per-model costs are per-process constants, the scan
  numbers scale with library size.

## Reproduce

```bash
cd apps/backend-rs/bench
PY=<venv>/Scripts/python.exe
$PY ml_footprint.py library                        # hard links under rust-pg/ml-foot/lib
$PY ml_footprint.py models --out models.json        # 2.2 (add --no-arena before `models`)
$PY ml_footprint.py models --only ocr --out iso_ocr.json   # 2.1, one per model
$PY ml_footprint.py scan rs --concurrency 1 --out scan_rs1.json   # 3 (also dj, 2, 4)
$PY footprint_sizes.py --out sizes.json --builds <dir>/builds.jsonl   # 1
```

`LP_RS_BIN` selects the binary; the Django side needs ports 8002-8012 free (its sidecars).
