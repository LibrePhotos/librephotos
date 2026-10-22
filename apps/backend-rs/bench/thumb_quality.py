"""WebP quality of the square thumbnails (OPTIMIZATIONS.md #9): the 500 px and 250 px squares
rendered from each big thumbnail the way `render.rs` does (libvips `thumbnail_image`,
`webpsave effort=2 keep=icc`), at Q95 and the candidate qualities: bytes, encode ms, and
SSIM / PSNR of each against the uncompressed resize (and Q<n> against Q95).

  python thumb_quality.py <dir with thumbnails_big/*.webp> [--q 80,85,90] [--limit 300]
"""
import argparse
import statistics as st
import time
from pathlib import Path

import numpy as np
import pyvips
from skimage.metrics import peak_signal_noise_ratio, structural_similarity


def to_np(img):
    return np.ndarray(buffer=img.write_to_memory(), dtype=np.uint8, shape=[img.height, img.width, img.bands])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("root")
    ap.add_argument("--q", default="80,85,90")
    ap.add_argument("--limit", type=int, default=300)
    a = ap.parse_args()
    qs = [95] + [int(q) for q in a.q.split(",")]
    bigs = sorted(Path(a.root, "thumbnails_big").glob("*.webp"))[: a.limit]
    res = {(s, q): {"bytes": [], "ms": [], "ssim": [], "psnr": [], "ssim95": []} for s in (500, 250) for q in qs}
    for f in bigs:
        big = pyvips.Image.new_from_file(str(f), access="sequential").copy_memory()
        for size in (500, 250):
            small = big.thumbnail_image(size).copy_memory()
            ref = to_np(small)
            dec95 = None
            for q in qs:
                t = time.perf_counter()
                buf = small.webpsave_buffer(Q=q, effort=2, keep="icc")
                ms = (time.perf_counter() - t) * 1000
                dec = to_np(pyvips.Image.new_from_buffer(buf, ""))
                if q == 95:
                    dec95 = dec
                r = res[(size, q)]
                r["bytes"].append(len(buf))
                r["ms"].append(ms)
                ch = -1 if ref.ndim == 3 else None
                r["ssim"].append(structural_similarity(ref, dec, channel_axis=ch))
                r["psnr"].append(peak_signal_noise_ratio(ref, dec))
                r["ssim95"].append(structural_similarity(dec95, dec, channel_axis=ch))
    print(f"{len(bigs)} big thumbnails from {a.root}")
    for (size, q), r in res.items():
        print(f"{size:>4} px Q{q}: {st.mean(r['bytes']):8.0f} B, encode {st.mean(r['ms']):5.2f} ms, "
              f"SSIM vs lossless {st.mean(r['ssim']):.4f} (min {min(r['ssim']):.4f}), "
              f"PSNR {st.mean(r['psnr']):5.2f} dB, SSIM vs Q95 {st.mean(r['ssim95']):.4f}")


if __name__ == "__main__":
    main()
