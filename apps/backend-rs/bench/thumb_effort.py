"""libwebp effort of the thumbnails (OPTIMIZATIONS.md #22): the big thumbnail (height 1080, Q95)
and the 500 / 250 px squares (Q80) rendered the way `render.rs` does (libvips `thumbnail`,
`webpsave keep=icc`), at effort 0..2: bytes, encode ms (one thread), SSIM / PSNR against the
uncompressed resize, and for the big one the pHash (imagehash.phash of the decoded WebP, what the
scan stores) against effort 2 (equal / Hamming distance).

  python thumb_effort.py <dir with JPEGs> [--every 20] [--efforts 0,1,2]
"""
import argparse
import io
import os
import statistics as st
import time
from pathlib import Path

import imagehash
import numpy as np
import pyvips
from PIL import Image
from skimage.metrics import peak_signal_noise_ratio, structural_similarity

os.environ.setdefault("VIPS_CONCURRENCY", "1")


def to_np(img):
    return np.ndarray(buffer=img.write_to_memory(), dtype=np.uint8, shape=[img.height, img.width, img.bands])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--every", type=int, default=20)
    ap.add_argument("--efforts", default="0,1,2")
    a = ap.parse_args()
    efforts = [int(e) for e in a.efforts.split(",")]
    files = sorted(p for p in Path(a.root).rglob("*") if p.suffix.lower() in (".jpg", ".jpeg"))[:: a.every]
    res = {}
    ph_same, ph_dist = {e: 0 for e in efforts}, {e: [] for e in efforts}
    for f in files:
        big = pyvips.Image.thumbnail(str(f), 10000, height=1080, size="down").copy_memory()
        if big.bands > 3:
            big = big.extract_band(0, n=3)
        layers = [("big", 95, big), ("500", 80, big.thumbnail_image(500).copy_memory()),
                  ("250", 80, big.thumbnail_image(250).copy_memory())]
        hashes = {}
        for name, q, img in layers:
            ref = to_np(img)
            for e in efforts:
                t = time.perf_counter()
                buf = img.webpsave_buffer(Q=q, effort=e, keep="icc")
                ms = (time.perf_counter() - t) * 1000
                dec = to_np(pyvips.Image.new_from_buffer(buf, ""))
                r = res.setdefault((name, e), {"bytes": [], "ms": [], "ssim": [], "psnr": []})
                r["bytes"].append(len(buf))
                r["ms"].append(ms)
                r["ssim"].append(structural_similarity(ref, dec, channel_axis=2))
                r["psnr"].append(peak_signal_noise_ratio(ref, dec))
                if name == "big":
                    hashes[e] = imagehash.phash(Image.open(io.BytesIO(buf)))
        if 2 in hashes:
            for e in efforts:
                ph_same[e] += hashes[e] == hashes[2]
                ph_dist[e].append(hashes[e] - hashes[2])
    print(f"{len(files)} JPEGs (every {a.every}th of {a.root})")
    print(f"{'size':>4} {'effort':>6} {'KB':>8} {'ms':>7} {'SSIM':>7} {'min':>7} {'PSNR':>6}")
    for (name, e), r in sorted(res.items()):
        print(f"{name:>4} {e:>6} {st.mean(r['bytes']) / 1024:8.1f} {st.mean(r['ms']):7.1f} {st.mean(r['ssim']):7.4f} "
              f"{min(r['ssim']):7.4f} {st.mean(r['psnr']):6.2f}")
    for e in efforts:
        d = ph_dist[e]
        print(f"pHash effort {e} == effort 2: {ph_same[e]}/{len(d)}, Hamming mean {st.mean(map(float, d)):.2f} max {max(d)}")


if __name__ == "__main__":
    main()
