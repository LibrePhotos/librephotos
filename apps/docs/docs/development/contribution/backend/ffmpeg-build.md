---
title: "The ffmpeg build"
description: "What LibrePhotos' own ffmpeg-bin wheel contains, why, how it is built and checked, and where its source is."
sidebar_position: 7
---

<Since version="1.7.0" /> Up to 1.6.0 the `ffmpeg-bin` wheel repackaged BtbN's GPL "everything" build, about 200 MB
installed. LibrePhotos now builds its own: the same input coverage for the files a library holds, in about a tenth of the space.

The backend, the Docker images and the Windows standalone build all run ffmpeg and ffprobe from the `ffmpeg-bin` wheel
that `apps/backend/requirements.txt` installs. The wheel puts its `bin/` folder on `PATH` at interpreter start (a `.pth`
file), and `api/runtime/binaries.py` is the only place that starts either tool.

## What the build contains

FFmpeg 9.0.2 with `--enable-gpl --disable-everything`, then only what LibrePhotos calls:

| Part | Enabled | Why |
| --- | --- | --- |
| Decoders, demuxers, parsers, bitstream filters | all of FFmpeg's own | the probe at scan time and every conversion must read whatever a camera, phone or old archive wrote |
| AV1 decoding | libdav1d | FFmpeg has no software AV1 decoder of its own |
| Encoders | `libx264` (8-bit 4:2:0 only), `aac`, `mjpeg`, `libwebp`, `libwebp_anim`, `wrapped_avframe`, `pcm_s16le` | animated previews and both playback conversions (H.264 + AAC), face-scan frames (JPEG), the big video thumbnail (WebP); the last two are what `-f null` uses to decode a file in tests |
| Muxers | `mp4 mov ipod tgp tg2 matroska webm avi asf flv mpegts mpeg1system mpeg2vob mpeg2svcd ogg ogv image2 webp null` | the playback copies, thumbnails and frames, and the metadata-free copy for sharing, which remuxes into the original container: one muxer for every extension in `VIDEO_EXTENSIONS` (`api/mime.py`) |
| Filters | `scale format zscale tonemap`, the filters ffmpeg inserts by itself (`aformat`, `aresample`, `null`, `anull`, `copy`, `trim`, `atrim`, `setpts`, `asetpts`, `fps`, `crop`), the automatic rotation (`transpose`, `hflip`, `vflip`, `rotate`) and `setparams`, `setsar`, `setdar` | the filter chains of `api/video/color.py` (HDR tonemapping needs zscale, which is libzimg) |
| Protocols | `file`, `pipe` | local files and the live conversion's stdout and `-progress pipe:2` |
| Other libraries | zlib | PNG-based and zlib-compressed tracks (Matroska, QuickTime `cmov`) |
| For tests and diagnosis | the `lavfi` input device, the `testsrc`, `testsrc2`, `color`, `sine` and `anullsrc` sources, `signalstats`, `concat`, the `ffv1` and `mpeg4` encoders | the backend's tests make their clips with the installed ffmpeg (`-f lavfi -i testsrc2=...`); a few hundred kB |
| Left out | every other input or output device, network, hardware acceleration, ffplay, docs, every other external library | never called |

Shared libraries as before: `bin/` plus `lib/` with an `$ORIGIN` rpath on Linux, `bin/` with the DLLs on Windows. Two
binaries would each carry libavcodec if they were linked statically. The external libraries are linked statically into
the FFmpeg libraries, so the wheel needs nothing from the system but the C and C++ runtimes (`manylinux_2_28`, checked
with `auditwheel show`; on Windows only system DLLs, checked by the build).

The external libraries of the old build that decode something were checked one by one:

| Library | Decodes | Decision |
| --- | --- | --- |
| libdav1d | AV1 | kept |
| libaom | AV1 | dropped, libdav1d decodes AV1 |
| libvpx | VP8, VP9 | dropped, FFmpeg's own decoders are the default for both |
| libopus, libvorbis | Opus, Vorbis | dropped, FFmpeg's own decoders are the default |
| libopencore-amr | AMR-NB, AMR-WB | dropped, FFmpeg decodes both itself |
| libopenh264 | H.264 | dropped, FFmpeg's own decoder is the default |
| libdavs2, libuavs3d | AVS2, AVS3 | dropped: Chinese broadcast formats, never written by a camera or phone |
| libjxl, librsvg | JPEG XL, SVG | dropped: still images, which pyvips decodes; ffmpeg only ever sees videos |
| libsnappy | nothing: FFmpeg decompresses HAP itself, the library is only for encoding it | dropped |
| libxml2 | DASH and IMF manifests | dropped: streaming and cinema delivery manifests, not files in a library |
| liblzma | LZMA-compressed TIFF frames | dropped |
| libaribb24, libaribcaption, libzvbi | ARIB and teletext subtitles | dropped: subtitles are never decoded (the copies use `-sn`) |
| libgme, libopenmpt, dvdread/dvdnav, avisynth | game music, tracker modules, DVD folders, AviSynth scripts | dropped: not video files; a `.vob` is read by the native MPEG-PS demuxer |

## Building and checking it

`.github/workflows/ffmpeg-wheel.yml` runs on every pull request that touches `apps/backend/scripts/ffmpeg/` or
`apps/backend/scripts/build_ffmpeg_wheel.py`:

1. `scripts/ffmpeg/sources.py fetch` downloads every source pinned in `scripts/ffmpeg/sources.json` and checks its
   SHA-256 (tarballs) or commit (git).
2. `scripts/ffmpeg/build.sh <target>` builds zlib, x264, dav1d, zimg, libwebp and FFmpeg: `linux-x86_64` and
   `linux-aarch64` in `quay.io/pypa/manylinux_2_28_*` on native runners, `win64` with mingw-w64 (win32 threads)
   on Ubuntu. It writes `LICENSE.txt`, `licenses/` and `BUILD.txt` (versions, toolchain, the configure line) into the
   staged folder.
3. `scripts/build_ffmpeg_wheel.py` packages that folder as `ffmpeg_bin-<version>-py3-none-<platform>.whl`.
4. `python -m scripts.ffmpeg.compat corpus` (run from `apps/backend`) makes a corpus of clips with the reference
   build, the old BtbN wheel, which has every encoder: H.264 (8-bit, 10-bit, 4:2:2, 4:4:4, odd sizes, interlaced),
   HEVC 8/10-bit with HDR10 and HLG, AV1, VP8, VP9, MPEG-1/2/4, Xvid, H.263, MJPEG, ProRes, DNxHR, DV, FLV1, WMV1/2/3,
   VC-1, Theora and FFV1 with AAC, MP3, AC-3, E-AC-3, Opus, Vorbis, FLAC, ALAC, PCM, AMR-NB/WB, MP2 and WMA audio, in
   MP4, MOV, MKV, WebM, AVI, MTS/M2TS, MPEG-PS, VOB, 3GP, 3G2, M4V, FLV, WMV/ASF and OGV, rotated by 90, 180 and 270
   degrees. It adds 31 real files from FFmpeg's FATE suite (camera and phone footage, Dolby Vision, ProRes HDR10 MXF,
   APV, CineForm, Canopus HQX, RealVideo, HAP, ...), pinned by SHA-256.
5. `python -m scripts.ffmpeg.compat check` fails when the new build lacks an encoder, decoder, filter, protocol or
   option the backend calls, and `compat matrix` runs every clip through both builds: ffprobe's stream list, then
   the backend's own commands for the first-frame WebP, the animated preview, the live and the cached conversion,
   the face-scan frame and the metadata-free copy, HDR tonemapping included. It fails on a pipeline that worked with
   the reference build and no longer does, on a codec no decoder reads any more and on a lost demuxer, unless
   `EXPECTED_*` in `compat.py` lists it with the reason. `api/tests/media_serving/test_ffmpeg_compat_mirrors.py`
   fails when the backend's commands and the ones `compat.py` runs drift apart.

The matrix and the sizes are in each run's summary and its `ffmpeg-matrix-*` artifacts.

To bump a component, change its entry in `sources.json` (version, URL and SHA-256, or the commit), open a pull
request and read the matrix. A new ffmpeg call in the backend that needs another encoder, muxer or filter needs it in
`build.sh` too (it fails when FFmpeg does not know a component name: 3GP is `tgp`, MPEG-PS is `mpeg1system`); `compat.py` and its mirror test then cover it.

## Licensing and source

x264 is GPL, so the build is GPL-2.0-or-later as a whole (no `--enable-version3`). FFmpeg runs as a separate process,
which keeps the MIT-licensed app, the Docker images and the Windows standalone build an aggregate. Each wheel carries
`ffmpeg_bin/LICENSE.txt` (the GPL and the list of components), `ffmpeg_bin/licenses/` (every component's license) and
`ffmpeg_bin/BUILD.txt`, and its `Source` URL points at the GitHub release the wheels are attached to. That release also
holds the corresponding source: the upstream tarballs of FFmpeg, dav1d, libwebp, zlib and NASM, `git archive`-style
tarballs of the pinned x264 and zimg commits (zimg with its submodule), the build scripts, and `SHA256SUMS`.

## Publishing a build

The release is made by hand, from a run whose matrix passed:

```bash
gh workflow run ffmpeg-wheel.yml --ref dev -f publish=true
```

The `publish` job creates the `ffmpeg-bin-<version>` release and attaches the three wheels and the source bundle.
Then point the three `ffmpeg-bin @` lines in `apps/backend/requirements.txt` at the new release, in a pull request
of their own.
