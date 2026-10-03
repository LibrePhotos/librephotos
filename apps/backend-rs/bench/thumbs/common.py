"""Shared paths and helpers for the ffmpeg-vs-libvips thumbnail benchmark.

Run every script with the Django Windows venv (pyvips 3.1.1 + pyvips-binary 8.18.6,
Pillow 12.3 + pillow-heif + pillow-jxl, imagehash, scikit-image, psutil):

    C:/Users/Niaz/librephotos/wt-windev/apps/backend/.venv-win/Scripts/python.exe <script>

LP_THUMBS_WORK points at a scratch directory (corpus + outputs, deleted afterwards).
"""

import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]  # wt-rust-backend
LIBREPHOTOS = REPO.parent
WORK = Path(os.environ.get("LP_THUMBS_WORK", HERE / "_work"))
CORPUS = WORK / "corpus"
OUT = WORK / "out"
VENV_SP = Path(
    os.environ.get("LP_THUMBS_VENV", LIBREPHOTOS / "wt-windev" / "apps" / "backend" / ".venv-win")
) / "Lib" / "site-packages"
FFMPEG = Path(os.environ.get("LP_FFMPEG", VENV_SP / "ffmpeg_bin" / "bin" / "ffmpeg.exe"))
FFPROBE = FFMPEG.with_name("ffprobe.exe" if FFMPEG.suffix == ".exe" else "ffprobe")

HEIGHTS = {"big": 1080, "m": 500, "s": 250}
WEBP_Q = 95
WEBP_EFFORT = 2
