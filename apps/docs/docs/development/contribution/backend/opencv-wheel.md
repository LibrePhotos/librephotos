---
title: "The OpenCV wheel"
description: "Which OpenCV the backend installs, what is in it, and how to rebuild it."
sidebar_position: 7
---

<Since version="1.7.0" /> The backend imports OpenCV as `cv2` from `opencv-lp-headless`, a wheel LibrePhotos builds
itself. It holds only the OpenCV modules the code calls. Up to 1.6.0 the backend installed
`opencv-python-headless` from PyPI, which carries every OpenCV module, a second OpenBLAS and its own FFmpeg.

## Who uses cv2

| Code | Calls |
| --- | --- |
| Face sidecar, `service/face_recognition/face_analysis.py` | `resize` (detector input), `warpAffine` (face alignment) |
| OCR sidecar, `service/ocr/ppocr/` | `imdecode`, `cvtColor`, `resize`, `findContours`, `minAreaRect`, `boxPoints`, `fillPoly`, `mean`, `getPerspectiveTransform`, `warpPerspective` |
| Photo editor, `api/editing/pipeline.py` and `source.py` | `resize` (`INTER_AREA`), `warpAffine`, `GaussianBlur`, `exp`, `log`, `cartToPolar`, `addWeighted`, `subtract`, `multiply`, `accumulate`, `accumulateProduct` |

The face sidecar made its network input with `cv2.dnn.blobFromImage(s)`. That is now `blob_from_images` in
`face_analysis.py`, a few lines of numpy that give the same float32 bits (`BlobFromImagesMatchesOpenCvDnnTest` pins
them), so the wheel needs no `dnn` module.

## What is in the wheel

`apps/backend/scripts/build_opencv_wheel.py` builds it with opencv-python's own build system, at the tag of the
`opencv-python-headless` release it replaces (`93`, OpenCV 5.0.0). It keeps the import name `cv2`, the package layout
(loader, typing stubs, licenses) and the version `5.0.0.93`, and changes only the CMake options:

- Modules (`MODULES`): `core`, `imgproc`, `geometry` (`minAreaRect`, `boxPoints`, `getPerspectiveTransform` moved
  there in OpenCV 5), `flann` (a dependency of `geometry`) and `imgcodecs`, plus the `python3` bindings.
- Image codecs: JPEG, PNG, TIFF and WebP from OpenCV's bundled sources, linked in statically, and BMP, which
  `imgcodecs` has built in. These are the formats of `CV2_DECODABLE_EXTENSIONS` in `api/mime.py`, which the OCR sidecar
  reads from the original. OpenEXR, JPEG 2000, AVIF, JPEG XL, GIF, HDR, PFM, PxM and Sun raster are off.
- Off: FFmpeg, GStreamer and every camera backend, LAPACK, Eigen, OpenCL, ITT and protobuf.
- Left at OpenCV's defaults, so the pixels match the PyPI wheel: Intel IPP (`ippicv`) on x86_64, the CPU baseline and
  the dispatched SIMD code, KleidiCV and Carotene on aarch64, and the threading backend.

The typing stubs generator of OpenCV 5.0.0 fails when a module it refines (such as `features`) is not built; the
script patches it to skip those, and drops the FFmpeg DLL that opencv-python's `setup.py` expects on Windows.

| Platform | `opencv-python-headless` 5.0.0.93 | `opencv-lp-headless` 5.0.0.93 |
| --- | --: | --: |
| Linux x86_64, installed | 159.5 MB | SIZE_X86 |
| Linux aarch64, installed | 90.3 MB | SIZE_ARM |
| Windows x64, installed | 117.6 MB | SIZE_WIN |

`opencv-python-headless` stays the requirement on macOS, which has no prebuilt wheel of ours. Both install the same
`cv2` package, so never install both into one environment.

## How it is built and checked

`.github/workflows/opencv-wheel.yml` builds the wheel for Linux x86_64 and aarch64 (in the `manylinux_2_28` images,
then `auditwheel`) and for Windows x64, with Python 3.14. The wheel uses the stable ABI (`cp37-abi3`), so one wheel
serves every Python. It runs on a pull request that changes the build script, the workflow or
`scripts/opencv_wheel_parity.py`, and then checks each wheel on its own platform:

- Nothing in `requirements*.txt` pulls `opencv-python-headless` back in.
- `scripts/opencv_wheel_parity.py` runs every cv2 path above, under the PyPI wheel and under ours, on the repository's
  JPEGs and on PNG (RGB, RGBA, grey, grey and alpha, palette, 16-bit), TIFF, WebP, BMP and CMYK, grey and progressive
  JPEG copies of one of them: the OCR decode, detection, crops and recognizer input, face alignment, detection input
  and embeddings (with `buffalo_sc`), and the editor renders of a recipe that touches every stage, in 8 and 16 bit. It
  fails on any difference, and prints the timings of the heavy editor operations on a 24 MP picture.
- The editor, face and OCR tests run on our wheel.
- On Windows, Nuitka compiles and runs a script that imports `cv2`, as the standalone build does.

## Publishing a new build

The wheels are assets of a `windows-wheels-*` GitHub release, like the other prebuilt wheels:

1. Point the three `opencv-lp-headless` lines of `apps/backend/requirements.txt` at the new release tag.
2. Run the `prebuilt-wheels` workflow from that branch with the tag. Its `opencv` job runs `opencv-wheel.yml`,
   checks and all, and uploads the three wheels to the release.

## Adding a module

Add it to `MODULES` in `build_opencv_wheel.py` (OpenCV adds the modules it depends on), and turn on any third-party
library it needs in `OPTIONS`. Then add the new calls to `opencv_wheel_parity.py`, so the check compares them, and
publish a new build. A call into a module that is not built fails with `AttributeError: module 'cv2' has no attribute`.
