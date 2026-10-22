"""A synthetic camera library for scan benchmarks.

    python make_library.py <out_dir> [count] [--size 4000x3000]

Writes ``count`` distinct JPEGs (camera-sized, EXIF date, camera, exposure,
some with GPS) into dated folders, plus one PNG screenshot per 25 photos,
under ``<out_dir>/alice``. Deterministic for a given count.
"""

import argparse
import datetime
import os
import random

import numpy as np
from PIL import Image


def exif_for(i, dt, gps):
    exif = Image.Exif()
    exif[0x010F] = "Bench"
    exif[0x0110] = f"Camera {i % 3}"
    stamp = dt.strftime("%Y:%m:%d %H:%M:%S")
    exif[0x0132] = stamp
    ifd = exif.get_ifd(0x8769)
    ifd[0x9003] = stamp
    ifd[0x829A] = (1, 125 * (1 + i % 4))
    ifd[0x829D] = (28 + i % 30, 10)
    ifd[0x8827] = 100 * (1 + i % 8)
    ifd[0x920A] = (35 + i % 50, 1)
    if gps:
        lat, lon = gps
        g = exif.get_ifd(0x8825)
        g[1] = "N" if lat >= 0 else "S"
        g[2] = (abs(int(lat)), int(abs(lat) * 60) % 60, 0)
        g[3] = "E" if lon >= 0 else "W"
        g[4] = (abs(int(lon)), int(abs(lon) * 60) % 60, 0)
    return exif


def picture(rng, w, h):
    y = np.linspace(0, 1, h, dtype=np.float32)[:, None]
    x = np.linspace(0, 1, w, dtype=np.float32)[None, :]
    base = np.stack(
        [
            (rng.random() * 255) * x + (rng.random() * 255) * (1 - y),
            (rng.random() * 255) * y + 40 * np.sin(x * rng.random() * 20),
            (rng.random() * 255) * (1 - x) * y + 60,
        ],
        axis=-1,
    )
    noise = np.random.default_rng(rng.randrange(1 << 30)).integers(0, 24, (h, w, 3), dtype=np.uint8)
    return Image.fromarray(np.clip(base + noise, 0, 255).astype(np.uint8))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("count", type=int, nargs="?", default=200)
    ap.add_argument("--size", default="4000x3000")
    args = ap.parse_args()
    w, h = map(int, args.size.split("x"))
    rng = random.Random(1234)
    root = os.path.join(args.out, "alice")
    start = datetime.datetime(2023, 1, 1, 9, 0)
    for i in range(args.count):
        dt = start + datetime.timedelta(hours=7 * i)
        folder = os.path.join(root, dt.strftime("%Y"), dt.strftime("%m"))
        os.makedirs(folder, exist_ok=True)
        gps = (48.1 + rng.random(), 11.5 + rng.random()) if i % 3 == 0 else None
        img = picture(rng, w, h) if i % 2 == 0 else picture(rng, h, w)
        img.save(os.path.join(folder, f"IMG_{i:05d}.jpg"), "JPEG", quality=90, exif=exif_for(i, dt, gps))
        if i % 25 == 0:
            shots = os.path.join(root, "Screenshots")
            os.makedirs(shots, exist_ok=True)
            picture(rng, 1080, 1920).save(
                os.path.join(shots, f"Screenshot_{dt:%Y%m%d-%H%M%S}.png"), "PNG"
            )


if __name__ == "__main__":
    main()
