# ffmpeg instead of libvips for image thumbnails? (2026-10-03)

Question: ffmpeg ships anyway (video thumbnails, transcodes). Can it also render the
image thumbnails (big <= 1080 px high, 500, 250; WebP Q95 effort 2; EXIF autorotate;
`local_orientation`) so the Rust image can drop libvips?

**Short answer: not as a full replacement.** ffmpeg 9.0.1 decodes every file in the
corpus, rotates every orientation correctly and reproduces libvips' output sizes
exactly. But it has no colour management (CMYK and ICC-tagged files render wrong), it
is slower on the common case (small JPEGs, PNGs) because of the process spawn, and
it changes the perceptual hash of ~27% of photos by 2-4 bits. The replaced-file check
compares pHashes for **exact** equality, so for existing libraries that last point
is a behaviour break. **Recommended: a hybrid.** Keep libvips, but use the same
self-contained libvips build production already runs (pyvips-binary 8.18.6, ~8 MB
compressed) instead of Debian's `libvips42t64` (40 MB, 121 packages). Let ffmpeg
take over what that build cannot decode (HEIC/HEIF grids, JPEG XL, BMP, JPEG 2000),
the job Pillow does today and which the Rust image (no Python) cannot do. That keeps
~80% of the size saving (~32 of 40 MB) with no pHash or colour regression.

Scripts: `bench/thumbs/` (README in each docstring). Raw results:
`results/2026-10-03-ffmpeg-vs-libvips/` (`matrix.json` per file, `tables.md`, `tp_*.json`,
`mem.json`, `deb_sizes.json`).

## Setup

- Machine: Ryzen 5 2600X (6C/12T), 32 GB, Windows 11; ~6% background CPU, nothing
  else heavy running. Windows process creation is part of every ffmpeg number.
- **libvips**: pyvips 3.1.1 + pyvips-binary **8.18.6** (the Django venv; the same build
  `apps/backend/requirements.txt` pins for production). It has no HEVC, JPEG XL, BMP or
  JPEG 2000 loader, so like `image_decoding.thumbnail` and `render.rs` those files go
  through Pillow + pillow-heif 1.7.0 / pillow-jxl 1.3.8 (EXIF-transposed, RGB). Called
  exactly like lp-ingest: `thumbnail(path, 10000, height=1080, size=down)`, `copy_memory`,
  `webpsave(Q=95, effort=2)`, then `thumbnail_image` to 500 / 250 from the in-memory big
  image; operation cache off.
- **ffmpeg**: `ffmpeg-bin` 9.0.1 wheel (`n9.0.1-30-g9258bacca5-20260915`, BtbN GPL shared
  build, the one production ships). `-buildconf` includes `--enable-libwebp --enable-libjxl
  --enable-libdav1d --enable-libaom --enable-libopenjpeg --enable-zlib --enable-lzma
  --enable-librsvg --enable-libzimg`; decoders used: mjpeg, png, tiff, gif, webp,
  hevc (HEIC), libdav1d (AVIF), libjxl, bmp, jpeg2000; demuxers `image2`, `*_pipe`,
  `mov,mp4,...` (HEIF/AVIF incl. tile grids as a stream group); encoder `libwebp`
  (pix_fmts bgra / yuv420p / yuva420p).
- **Corpus** (138 files, 198 MB, `thumbs/make_corpus.py`): the Rust fixture library
  (`rust-pg/fixture/data`: JPEG, PNG, HEIC, DNG), `deploy/e2e/photos`, the E2E-ML check
  library (66 JPEGs, scikit-image sample photos, documents, faces), and generated edge
  cases. Generated photos are mosaics of real sample photos, upscaled, with grain, a zone
  plate and fine text: JPEG 12 MP / 24 MP (4:2:0 and 4:4:4) / progressive, EXIF
  orientations 1-8 (+ a 12 MP orientation 6), CMYK with the SWOP profile, Adobe RGB
  with an embedded ICC, 16-bit PNG, PNG with alpha, palette PNG, greyscale, lossy WebP,
  AVIF, JPEG XL, TIFF (+ orientation 6), animated GIF, HEIC single / 512 px tile grid
  (iPhone layout) / grid + irot + EXIF orientation 6 / Adobe-RGB-tagged grid, a
  12000x2000 panorama, 16x16 JPEG/PNG, odd 1001x777, a JPEG cut at 60%.

## The ffmpeg pipeline that best matches libvips

One process per image, all three sizes from one decode (`pipelines.ffmpeg_cmd`):

```
ffmpeg -hide_banner -v error -nostdin -y -i IN -filter_complex "
  [0:v:0]scale=w='if(gt(ih,1080),max(1,round(iw*1080/ih)),iw)':h='min(ih,1080)'
         :flags=lanczos+accurate_rnd+full_chroma_int+full_chroma_inp,split=3[b0][m0][s0];
  [b0]format=pix_fmts=yuv420p|yuva420p[big];
  [m0]scale=<same box, 500>:flags=...,format=pix_fmts=yuv420p|yuva420p[m];
  [s0]scale=<same box, 250>:flags=...,format=pix_fmts=yuv420p|yuva420p[s]"
  -map [big] -c:v libwebp -quality 95 -compression_level 2 -frames:v 1 -update 1 -f webp big.webp
  -map [m]   (same) m.webp   -map [s] (same) s.webp
```

- **Sizes**: the box expression is libvips' rule (height `min(ih, H)`, width rounded,
  never upscaled; no `-2`, odd widths stay odd). Identical to libvips on **all 138 files
  x 3 sizes**. Plain `scale=-1:250` upscales 16x16 to 250x250.
- **Orientation**: ffmpeg >= 8.1 parses EXIF (Changelog 8.1: "EXIF Metadata Parsing")
  and the CLI autorotates stills by it: JPEG and TIFF orientations 2-8, HEIC `irot`,
  and HEIC grid + irot + EXIF 6 (iPhone) without rotating twice. Verified on 9.0.1:
  0 of 138 wrong (best of the 8 transforms against Pillow's `exif_transpose` is the
  identity for every file, for both renderers). `local_orientation` maps to filters,
  checked pixel-exact against render.rs `orient` (`check_local_orientation.py`):
  2 `hflip`, 3 `hflip,vflip`, 4 `vflip`, 5 `transpose=clock,hflip`, 6 `transpose=cclock`,
  7 `transpose=cclock,hflip`, 8 `transpose=clock`.
- **HEIF tile grids** (every iPhone HEIC) need `-filter_complex` with the stream group
  as input, `[0:g:0]`; `[0:v:0]` would be the first 512 px tile and `-vf` is refused.
  A single-image HEIC has no group, so HEIF files try `[0:g:0]` first and fall back to
  `[0:v:0]` (a second process for non-grid HEIC/AVIF). The CLI grid support is also 8.1+.
- **Encoder**: `-quality 95 -compression_level 2` = libvips' `Q=95, effort=2` (libwebp
  `method`); preset none = libwebp defaults, as libvips; `-frames:v 1 -update 1 -f webp`.
  Big WebP sizes: median ratio ffmpeg/libvips 1.000 (RGB) / 0.996 (YUV).
- **Two variants measured**: *RGB* (`format=rgb24|rgba|rgb48le|rgba64le` before the scale,
  `format=bgra` into libwebp, so libwebp does the RGB->YUV conversion exactly as it does
  for libvips) and *YUV* (scale in the decoder's YUV, libwebp takes yuv420p directly).
  YUV is ~25% faster on large JPEGs and uses half the memory; RGB is slightly closer
  to libvips at the small sizes. Palette PNGs need no special case in either variant.
- No `-lowres` (the mjpeg analogue of libvips' shrink-on-load): it only kicks in for
  images >= 4320 px high at these targets.

## 1. Coverage and correctness

Per file (big thumbnail; dE = mean / p95 CIEDE2000 of the *displayed* colour, i.e.
through the WebP's own ICC profile as a browser renders it, against an ICC-aware Pillow
decode; pHash = Hamming distance of LibrePhotos' pHash to the libvips render):

| file | source px | libvips 8.18.6 (prod) | ffmpeg RGB | ffmpeg YUV |
|---|---|---|---|---|
| fixture sample.heic | 800x600 | Pillow fallback, dE 0.34 | dE 0.52, 0 b | dE 0.52, 0 b |
| fixture DSC_0001.dng | (IFD0 200x150) | decodes the 200x150 IFD0 thumb | same | same |
| JPEG 12 MP / progressive | 4032x3024 | dE 1.10 / 1.08 | 1.13 / 1.15, 2 b / 2 b | 1.26 / 1.22, 0 b / 0 b |
| JPEG 24 MP 4:2:0 / 4:4:4 | 6000x4000 | 1.25 / 1.48 | 1.27 / 1.48, 0 b | 1.47 / 1.67, 0 b |
| EXIF orientation 1-8 | 1600x1200 | all upright | all upright, 0 b | all upright, 0 b |
| orientation 6, 12 MP | 4032x3024 | upright | upright, 2 b | upright, 0 b |
| TIFF LZW / TIFF + orientation 6 | 3000x2000 | 1.94 / upright | 1.94 / upright, 0 b | 1.93 / upright, 0 b |
| **CMYK + SWOP ICC** | 3000x2000 | **ICC applied, dE 2.41 / 4.91** | **naive CMYK, dE 7.18 / 15.48**, 2 b | **7.19 / 15.49**, 2 b |
| **Adobe RGB + ICC** | 3000x2000 | **ICC kept in WebP, dE 2.09 / 5.13** | **ICC dropped, dE 3.14 / 6.42**, 0 b | 3.14 / 6.37, 0 b |
| 16-bit PNG / palette PNG / grey JPEG | 3000x2000 | 1.94 / 1.93 / 0.36 | 1.95 / 1.92 / 0.35, 0 b | 1.94 / 1.94 / 0.35, 0 b |
| **PNG with alpha** | 3000x2000 | alpha kept; transparent RGB = black | alpha kept; transparent RGB = colour, **10 b** | same, **10 b** |
| WebP / AVIF | 3000x2000 | 1.46 / 1.17 | 1.26 / 1.18, 0 b | 1.18 / 1.27, 0 b |
| JPEG XL | 3000x2000 | Pillow fallback, 1.18 | 1.18, 0 b | 1.17, 0 b |
| HEIC single / orientation 6 | 3000x2000 | Pillow fallback, 1.65 / 1.65 | 1.67 / 1.67, 0 b | 1.83 / 1.83, 0 b |
| HEIC 512 px grid / grid + irot + EXIF 6 | 4032x3024 | Pillow fallback, 1.42 / 1.42 | grid 1.45 / 1.44, 0 b / 2 b | 1.65 / 1.64, 0 b |
| HEIC grid tagged Adobe RGB | 4032x3024 | Pillow fallback drops the ICC, 2.83 | drops it, 2.82, 0 b | 3.00, 0 b |
| GIF (first frame) | 800x600 | 3.46 | 3.46, 0 b | 3.44, 0 b |
| panorama | 12000x2000 | 1.16 (6480x1080) | 1.18, same size, 0 b | 1.29, 0 b |
| 16x16 JPEG / PNG | 16x16 | not upscaled | not upscaled, 4 b / 0 b | 2 b / 2 b |
| **JPEG truncated at 60%** | 4032x3024 | missing rows **grey** (like Pillow) | missing rows **green** (YUV 0), SSIM 0.71 vs libvips | same |

Failures: none for either tool. Every file decodes with both.

What ffmpeg gets wrong (all reproducible in `matrix.json`):

1. **No colour management.** CMYK is converted without its profile (p95 dE 15, plainly
   wrong colours); RGB ICC profiles are neither applied nor carried into the WebP
   (libvips keeps the profile, so browsers show Adobe RGB / Display P3 photos correctly).
   ffmpeg has `iccdetect`/`iccgen`, but they only map profiles onto the few primaries
   ffmpeg knows and do nothing for CMYK; not attempted here. Note the Pillow fallback
   loses HEIC ICC profiles too, so today's HEIC thumbnails are no better.
2. **Truncated JPEGs** render the missing part green instead of grey.
3. **Alpha**: libvips premultiplies for the resize, so fully transparent pixels come out
   RGB 0; ffmpeg keeps the colour underneath. Both are invisible in the browser, but
   pHash drops alpha (`convert("RGB")`), so the hash differs by 10 bits.
4. **No metadata in the output.** libvips copies EXIF/XMP/ICC into the thumbnail; ffmpeg
   writes none. Side finding: **libvips thumbnails today carry the original's GPS EXIF**
   (3 fixture photos with GPS, all 3 thumbnails keep it), and thumbnails are what shared
   and public views load. ffmpeg's output does not. Worth fixing on its own (`keep=icc` in webpsave).
5. **ML JPEG decoding**: `vips::install_ml_decoder` decodes JPEGs for in-process ML through
   libvips to be bit-exact with Pillow/cv2. Without libvips that falls back to the Rust
   decoder ("a few levels off"): not a thumbnail problem, but a reason libvips stays.

## 2. Quality and the perceptual hash

SSIM / PSNR (RGB, 8-bit, data range 255), medians over the 138 files:

| size | ffmpeg RGB vs libvips | ffmpeg YUV vs libvips | ffmpeg RGB vs Pillow LANCZOS | ffmpeg YUV vs Pillow | libvips vs Pillow |
|---|---|---|---|---|---|
| big (1080) | 0.9859 / 43.06 dB | 0.9866 / 42.72 | 0.9876 / 43.78 | 0.9887 / 43.83 | 0.9881 / 43.89 |
| 500 | 0.9886 / 43.23 | 0.9865 / 41.31 | 0.9844 / 41.88 | 0.9850 / 40.89 | 0.9850 / 41.44 |
| 250 | 0.9886 / 42.11 | 0.9837 / 39.45 | 0.9796 / 37.44 | 0.9771 / 36.80 | 0.9790 / 36.90 |

ffmpeg is as close to libvips as libvips is to an independent Pillow LANCZOS reference,
and equally good against that reference: visually a wash. Worst big-size SSIM vs libvips:
truncated JPEG 0.71, CMYK 0.78, alpha PNG 0.88 (the three defects above), lossy WebP
source 0.96 (different WebP decoders), then 0.966 for an ordinary photo.

**pHash** (`api/perceptual_hash.py`: `imagehash.phash` of the big WebP), distance to the
libvips hash:

| renderer | identical | 2 bits | 4 bits | 10 bits | <= 10 bits |
|---|---:|---:|---:|---:|---:|
| ffmpeg RGB | 99 / 138 (72%) | 34 | 4 | 1 (alpha PNG) | 138 |
| ffmpeg YUV | 102 / 138 (74%) | 28 | 7 | 1 (alpha PNG) | 138 |
| for scale: libvips effort 2 vs libwebp default effort (the "legacy" render) | 108 / 132 (82%) | 22 | 2 | 0 | 132 |

By source: fixture 13/36 differ, generated 8/36, E2E-ML 18/66 (RGB). Only 4 of the
39 RGB mismatches happen to equal the legacy render.

What that means for existing libraries:

- **Duplicate detection and burst grouping**: threshold `DEFAULT_HAMMING_THRESHOLD = 10`;
  every file stays within it (the alpha PNG exactly at 10). Mixed libraries (old libvips
  hashes, new ffmpeg hashes) keep finding their duplicates.
- **Replaced-file check breaks** (`file_handlers._picture_verdict`, Rust
  `pipeline.rs` ~L740): when a file's bytes change (a rating or face region written back
  by exiftool, any metadata editor), the photo is re-rendered and its pHash must equal
  the stored one **exactly**, else the legacy (libvips default-effort) render must. With
  ffmpeg ~27% of unchanged pictures fail both and are classified `NEW_PICTURE`: everything
  derived from the photo is dropped and rebuilt. The legacy fallback itself needs libvips.
  It is also a mixed-library break for the plan's correctness bar ("equal to a
  Django-scanned one wherever a later comparison depends on it"). A full switch would need
  the comparison relaxed to a small distance (all non-alpha mismatches here are <= 4 bits)
  or a re-render-and-rehash of the whole library after the switch (recomputing from the
  existing big thumbnails reproduces the libvips hash, so it does not help).

## 3. Throughput

Full big/m/s set per image, whole-image wall time, ~12 s per cell after a warm-up, alone
on the machine (`throughput.py`). libvips in-process (as lp-ingest), ffmpeg one process per
image ("1 proc") or three (big from the original, 500 and 250 each re-read from big.webp,
as `api/thumbnails.py` does). images/s (mean latency ms):

**1 worker**

| class | libvips | ffmpeg RGB, 1 proc | ffmpeg YUV, 1 proc | ffmpeg RGB, 3 procs |
|---|---:|---:|---:|---:|
| JPEG small (<= 2 MP, 60 files) | **12.1** (82) | 6.8 (147) | 8.3 (120) | 3.4 (294) |
| JPEG 12 MP | **3.78** (264) | 2.83 (353) | 3.44 (290) | 1.68 (593) |
| JPEG 24 MP | **2.90** (345) | 2.14 (467) | 2.75 (363) | 1.44 (696) |
| PNG 6 MP | **3.22** (310) | 1.83 (546) | 1.95 (511) | 1.22 (816) |
| HEIC 12 MP grid | 1.59 (627) *Pillow* | 1.92 (521) | **2.24** (446) | 1.32 (759) |
| panorama 12000x2000 | 1.13 (886) | 0.99 (1014) | **1.22** (821) | 0.54 (1857) |

**4 workers**

| class | libvips | ffmpeg RGB, 1 proc | ffmpeg YUV, 1 proc | ffmpeg RGB, 3 procs |
|---|---:|---:|---:|---:|
| JPEG small | **36.6** (92) | 19.9 (172) | 23.9 (144) | 10.1 (352) |
| JPEG 12 MP | **11.7** (302) | 8.0 (479) | 11.2 (336) | 5.26 (737) |
| JPEG 24 MP | **9.33** (421) | 6.23 (630) | 9.09 (430) | 4.50 (872) |
| PNG 6 MP | **10.9** (360) | 5.92 (666) | 6.67 (590) | 3.98 (990) |
| HEIC 12 MP grid | 4.05 (977) *Pillow* | 3.73 (1033) | **4.50** (871) | 3.04 (1296) |
| panorama | 3.59 (1106) | 2.96 (1338) | **4.21** (937) | 1.73 (2281) |

ffmpeg YUV vs libvips at 4 workers: small JPEG -35%, 12 MP -4%, 24 MP -3%, PNG -39%,
HEIC +11% (vs the Pillow fallback), panorama +17%. RGB is 18-46% slower than libvips
everywhere but HEIC; three processes per image is never worth it.

Where ffmpeg's time goes (12 MP JPEG, one process, medians): bare `ffmpeg -version`
**37 ms** (Windows process creation + DLL load; `spawn.json`), decode 57 ms more, RGB
conversion + Lanczos 92 ms, WebP big ~90 ms. For a small JPEG the spawn is half the
cost, which is the whole gap to libvips. Linux `fork/exec` is cheaper than Windows
`CreateProcess`, so the small-file gap should shrink in Docker (not measured here).
`-threads 1 -filter_threads 1` changes nothing (338 vs 350 ms): the work is single-threaded.

**Peak memory per conversion** (fresh process each; libvips = the Python process's peak
minus `python + import pyvips`, 23 MiB WS; ffmpeg = whole process), working set / private MiB:

| class | libvips | ffmpeg RGB | ffmpeg YUV |
|---|---:|---:|---:|
| JPEG small | 7 / 7 | 34 / 36 | 29 / 31 |
| JPEG 12 MP | 57 / 55 | 126 / 129 | 65 / 67 |
| JPEG 24 MP | 95 / 90 | 194 / 197 | 89 / 91 |
| PNG 6 MP | 36 / 37 | 86 / 90 | 72 / 75 |
| HEIC 12 MP grid | 184 / **532** (Pillow) | 165 / 173 | 143 / 155 |
| panorama | 153 / 149 | 285 / 288 | 128 / 133 |

## 4. Image size: what dropping libvips really saves

Debian Packages index (`thumbs/deb_sizes.py`; Depends + Pre-Depends, no Recommends,
minus the debian-slim base), MB = 10^6 bytes, "debs" = compressed download (xz; Docker
layers are gzip, add ~10-20%):

| | trixie amd64 | trixie arm64 | bookworm amd64 | bookworm arm64 |
|---|---:|---:|---:|---:|
| libvips version | 8.16.1 | 8.16.1 | 8.14.1 | 8.14.1 |
| libvips closure: packages / installed / debs | 121 / 126.1 / **40.2** | 121 / 130.7 / **36.6** | 96 / 161.1 / 47.8 | 96 / 148.5 / 43.1 |
| saving if ffmpeg comes from the ffmpeg-bin wheel (the Rust image plan) | **40.2** debs, 126.1 inst. (all 121 pkgs) | **36.6**, 130.7 | 45.7, 155.2 | 41.3, 142.7 |
| saving if ffmpeg were Debian's `ffmpeg` (7.1.5 / 5.1.9) | 19.3, 61.5 | 17.8, 67.5 | 14.5, 43.7 | 13.0, 47.7 |
| saving with Debian's libav* libs only (no CLI) | 19.4, 61.9 | 17.9, 68.1 | 14.5, 43.7 | 13.0, 47.7 |
| Debian `ffmpeg` CLI closure itself | 207 pkgs, 445 inst., 133 debs | 410, 121 | 459, 134 | 397, 118 |

Biggest libvips dependencies on trixie: ImageMagick (`libmagickcore-7`, 7-12 MB),
OpenEXR, librsvg, poppler, HDF5 (via matio), openslide, libheif + de265/dav1d, libjxl,
libraw, highway, glib.

Against the ML_FOOTPRINT image estimate (~193 MB amd64 / ~180 MB arm64 compressed, with
Debian libvips and the ffmpeg-bin libs): **dropping libvips saves ~40 / 37 MB (about
21%)**, to ~153 / ~143 MB. Nothing else in the image shares that closure. The alternative
in the recommendation, the self-contained pyvips-binary libvips (18.5 MB installed,
8.1 / 8.2 MB wheel), costs ~8 MB, so it **saves ~32 / ~29 MB** of the 40 / 37.

## 5. Recommendation

**Hybrid, keep libvips (a slim build):**

1. Ship the self-contained libvips production already uses (pyvips-binary 8.18.6's `.so`
   on x86_64/aarch64, or the equivalent sharp-libvips build) instead of Debian's
   `libvips42t64`. ~8 MB instead of ~40 MB compressed, and it is **the same renderer as
   today's Django image**, so pHashes, colours and thumbnails stay identical for existing
   libraries. Debian's 8.16 with native HEIF/ImageMagick loaders would itself be a
   different renderer from production.
2. Route what that build cannot load (HEIC/HEIF grids, JPEG XL, BMP, JPEG 2000) through
   ffmpeg with the YUV pipeline above, instead of the Pillow fallback. The Rust image has
   no Python, so it needs this anyway. Measured: same sizes and orientation as the Pillow
   path, pHash identical on all 6 HEIC files with YUV (5 of 6 with RGB: one grid 2 bits),
   faster (HEIC grid 4.5 vs 4.05 images/s at 4 workers) and lighter (155 vs 532 MiB
   private).
3. Small follow-up regardless of the choice: libvips thumbnails copy the original's EXIF,
   GPS included, into every thumbnail; consider `keep=icc` (or `strip` + ICC) in webpsave.

**Do not replace libvips entirely** while the replaced-file check needs exact pHash
equality. A full switch would save another ~8 MB and would need:

- ffmpeg **>= 8.1** with `--enable-libwebp`, the `hevc` decoder + `mov` demuxer (HEIC,
  CLI tile grids), `libdav1d` or `libaom` (AVIF), `--enable-libjxl`, the native `png`,
  `mjpeg`, `tiff`, `gif`, `webp`, `bmp` decoders and `zlib`, plus `libopenjpeg` for
  JPEG 2000. The ffmpeg-bin 9.0.1 build has all of it. **Debian trixie's ffmpeg 7.1.5
  does not qualify**: no EXIF autorotation, no CLI tile-grid support (both 8.1). It would
  also be the bigger option (19 MB saved instead of 40).
- the YUV pipeline (RGB costs 30-45% throughput and twice the memory for no visible gain);
- accepting no colour management (CMYK, ICC-tagged RGB) and green-filled truncated JPEGs,
  or adding lcms in Rust for CMYK/ICC sources;
- the replaced-file comparison relaxed to a distance (<= 4 bits covered every non-alpha
  case here) or a one-off re-render + rehash of every existing photo; otherwise ~27% of
  photos whose files get metadata written back lose their derived data;
- a decodability check without libvips' header load (`ffprobe` = another process, or the
  `infer` sniff), plus re-checking which files get indexed: Debian libvips (ImageMagick,
  poppler, openslide) and ffmpeg load different sets of exotic formats;
- the in-process ML JPEG decoder falling back to the Rust decoder (not bit-exact with
  Pillow/cv2), or another libjpeg-turbo binding;
- accepting ~35-40% lower throughput for small JPEGs and PNGs (spawn-bound; less on Linux).

Not measured here: the pure-Rust path `render.rs` already has for builds without libvips
(`image` + `fast_image_resize` + libwebp). It needs no extra library at all for JPEG/PNG/
WebP/TIFF/GIF and could pair with ffmpeg for HEIC/JXL in the same way; its colour handling
and pHash agreement would need the same matrix before it could be a candidate.

## Caveats

- Windows host: process creation is slower than on Linux, so the ffmpeg spawn overhead is
  pessimistic here. Linux numbers (and Debian's libvips 8.16, which decodes HEIC natively)
  were not measured: no Docker on this box.
- The libvips HEIC/JXL numbers are the Pillow fallback (pyvips-binary has no HEVC/JXL), the
  production behaviour today, not what a libvips with libheif would do.
- The Linux ffmpeg-bin wheel is assumed to be built like the Windows one measured here (same
  BtbN autobuild, same version); check `ffmpeg -buildconf` in the image.
- Generated photos are mosaics of real sample photos with grain, not camera files; real
  camera JPEGs may flip pHash bits at a somewhat different rate. The fixture and E2E-ML
  photos (real content) differed at 36% / 27%, the generated set at 22%.
- RAW is out of scope for both: the pipeline never sends RAW to libvips (embedded preview
  via rawpy/Rust, else the RAW renderer). Both tools only find the DNG's 200x150 IFD0 thumb.
- Throughput cells are ~12 s each (one run per cell); libvips used its default threading.
