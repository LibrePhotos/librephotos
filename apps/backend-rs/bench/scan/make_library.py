"""Generate the W4 scan library: unique JPEGs re-encoded from deploy/e2e/photos with
varied size, quality, EXIF date, camera and GPS, plus a few PNG screenshots and
short videos.

    python make_library.py <out_dir> [--jpegs 2000 --pngs 20 --videos 5]

Deterministic (seeded). Sizes: 60% 4032x3024 (phone), 25% 2048x1536, 15% 800x600.
Run with the Django venv (Pillow; ffmpeg from the ffmpeg-bin wheel).
"""

import argparse
import glob
import os
import random
import subprocess
import sys
from concurrent.futures import ProcessPoolExecutor

from PIL import Image, ImageDraw

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
SOURCES = sorted(glob.glob(os.path.join(REPO, "deploy", "e2e", "photos", "*.jpg")))
CAMERAS = [("Apple", "iPhone 13"), ("Google", "Pixel 7"), ("samsung", "SM-G991B"), ("SONY", "ILCE-7M3"), ("FUJIFILM", "X-T4")]
CITIES = [(52.52, 13.405), (48.857, 2.352), (41.903, 12.496), (35.676, 139.65), (40.713, -74.006), (51.507, -0.128)]


def dms(x):
    x = abs(x)
    d = int(x)
    m = int((x - d) * 60)
    s = round(((x - d) * 60 - m) * 60, 2)
    return (float(d), float(m), float(s))


def make_jpeg(args):
    i, out = args
    rng = random.Random(i)
    src = Image.open(SOURCES[i % len(SOURCES)]).convert("RGB")
    r = rng.random()
    size = (4032, 3024) if r < 0.6 else (2048, 1536) if r < 0.85 else (800, 600)
    if rng.random() < 0.3:
        size = (size[1], size[0])
        src = src.rotate(90, expand=True)
    img = src.resize(size, Image.BICUBIC)
    noise = Image.effect_noise(size, 40 + rng.random() * 40).convert("RGB")
    img = Image.blend(img, noise, 0.08 + rng.random() * 0.08)
    d = ImageDraw.Draw(img)
    d.rectangle([rng.randrange(size[0] // 2), rng.randrange(size[1] // 2), size[0] // 2 + rng.randrange(size[0] // 2),
                 size[1] // 2 + rng.randrange(size[1] // 2)], outline=(rng.randrange(256), rng.randrange(256), rng.randrange(256)), width=12)
    d.text((40, 40), f"bench #{i}", fill=(255, 255, 255))
    year = 2015 + rng.randrange(11)
    month = 1 + rng.randrange(12)
    ts = f"{year}:{month:02d}:{1 + rng.randrange(28):02d} {7 + rng.randrange(15):02d}:{rng.randrange(60):02d}:{rng.randrange(60):02d}"
    make, model = CAMERAS[rng.randrange(len(CAMERAS))]
    exif = Image.Exif()
    exif[0x010F] = make
    exif[0x0110] = model
    exif[0x0132] = ts
    exif[0x0112] = 1
    e = exif.get_ifd(0x8769)
    e[0x9003] = ts
    e[0x9004] = ts
    e[0x829D] = 1.8 + rng.randrange(40) / 10
    e[0x8827] = rng.choice([50, 100, 200, 400, 800, 1600])
    if rng.random() < 0.4:
        lat, lon = CITIES[rng.randrange(len(CITIES))]
        lat += (rng.random() - 0.5) * 0.1
        lon += (rng.random() - 0.5) * 0.1
        g = exif.get_ifd(0x8825)
        g[1] = "N" if lat >= 0 else "S"
        g[2] = dms(lat)
        g[3] = "E" if lon >= 0 else "W"
        g[4] = dms(lon)
    folder = os.path.join(out, str(year), f"{month:02d}")
    os.makedirs(folder, exist_ok=True)
    path = os.path.join(folder, f"IMG_{i:05d}.jpg")
    img.save(path, "JPEG", quality=70 + rng.randrange(26), exif=exif.tobytes())
    return path


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--jpegs", type=int, default=2000)
    ap.add_argument("--pngs", type=int, default=20)
    ap.add_argument("--videos", type=int, default=5)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    with ProcessPoolExecutor(max_workers=os.cpu_count()) as ex:
        n = sum(1 for _ in ex.map(make_jpeg, [(i, a.out) for i in range(a.jpegs)], chunksize=8))
    shots = os.path.join(a.out, "Screenshots")
    os.makedirs(shots, exist_ok=True)
    for i in range(a.pngs):
        rng = random.Random(10_000 + i)
        img = Image.new("RGB", (1080, 2340), (rng.randrange(256), rng.randrange(256), rng.randrange(256)))
        d = ImageDraw.Draw(img)
        for k in range(40):
            d.rectangle([40, 60 + k * 55, 40 + rng.randrange(1000), 100 + k * 55], fill=(rng.randrange(256),) * 3)
        img.save(os.path.join(shots, f"Screenshot_2024{1 + i % 12:02d}{1 + i:02d}-120000.png"))
    ffmpeg = os.path.join(sys.prefix, "Lib", "site-packages", "ffmpeg_bin", "bin", "ffmpeg.exe")
    vids = os.path.join(a.out, "Videos")
    os.makedirs(vids, exist_ok=True)
    for i in range(a.videos):
        subprocess.run([ffmpeg, "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"testsrc2=size=1280x720:rate=30:duration={4 + i}",
                        "-f", "lavfi", "-i", f"sine=frequency={300 + 100 * i}:duration={4 + i}", "-c:v", "libx264",
                        "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", os.path.join(vids, f"VID_{i:03d}.mp4")], check=True)
    print(f"{n} jpegs, {a.pngs} pngs, {a.videos} videos in {a.out}")


if __name__ == "__main__":
    main()
