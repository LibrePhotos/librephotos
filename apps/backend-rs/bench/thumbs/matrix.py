"""Coverage / correctness / quality / pHash matrix: libvips vs ffmpeg thumbnails.

For every corpus file and renderer (vips, ffmpeg = RGB pipeline, ffmpeg_yuv = scale in
YUV and let libwebp take yuv420p): does it decode, are the three sizes the ones libvips
produces, is the big thumbnail upright (best of the 8 orientations against Pillow's
exif_transpose), how far is the displayed colour from an ICC-aware Pillow reference
(mean CIEDE2000; WebPs are rendered through their own ICC profile as a browser would),
SSIM/PSNR against libvips and against a Pillow LANCZOS reference at each size, and
LibrePhotos' pHash (api/perceptual_hash.py: imagehash.phash of the big WebP) per
renderer with the Hamming distance to libvips'.

    python matrix.py [--only substring] -> $LP_THUMBS_WORK/matrix.json
"""

import argparse
import io
import json
import traceback
from pathlib import Path

import imagehash
import numpy as np
import pillow_heif
import pillow_jxl  # noqa: F401
from PIL import Image, ImageCms, ImageFile, ImageOps
from skimage.color import deltaE_ciede2000, rgb2lab
from skimage.metrics import peak_signal_noise_ratio, structural_similarity

from common import CORPUS, OUT, WORK
from pipelines import RENDERERS, SIZES, _vips

pillow_heif.register_heif_opener()
Image.MAX_IMAGE_PIXELS = None
ImageFile.LOAD_TRUNCATED_IMAGES = True
SRGB = ImageCms.createProfile("sRGB")
TESTED = ("vips", "ffmpeg", "ffmpeg_yuv")
# Files whose colour truth is the sRGB scene they were made from. Not the CMYK file:
# SWOP clips sRGB, so its truth is its own ICC-aware decode (the default).
GROUND_TRUTH = {"adobergb_icc.jpg": "png_rgb.png"}

TRANSFORMS = {
    "identity": lambda a: a,
    "flipH": lambda a: a[:, ::-1],
    "rot180": lambda a: a[::-1, ::-1],
    "flipV": lambda a: a[::-1],
    "transpose": lambda a: a.transpose(1, 0, 2),
    "rot90": lambda a: np.rot90(a, 1),
    "transverse": lambda a: np.rot90(a, 2).transpose(1, 0, 2),
    "rot270": lambda a: np.rot90(a, 3),
}


def phash(path):
    """api/perceptual_hash.calculate_perceptual_hash."""
    with Image.open(path) as img:
        if img.mode not in ("RGB", "L"):
            img = img.convert("RGB")
        return str(imagehash.phash(img, hash_size=8))


def hamming(a, b):
    return int(imagehash.hex_to_hash(a) - imagehash.hex_to_hash(b))


def to_srgb(im):
    """Displayed sRGB pixels: through the embedded ICC profile when there is one."""
    icc = im.info.get("icc_profile")
    if icc:
        try:
            src = ImageCms.ImageCmsProfile(io.BytesIO(icc))
            mode = "RGB" if im.mode in ("RGB", "RGBA", "CMYK", "L") else None
            base = im if im.mode in ("RGB", "CMYK") else im.convert("RGB")
            return ImageCms.profileToProfile(base, src, SRGB, outputMode=mode or "RGB")
        except Exception:
            pass
    return im.convert("RGB")


def reference(path):
    """(raw RGB, ICC-aware sRGB) upright Pillow decodes, or None."""
    try:
        with Image.open(path) as im:
            im.load()
            up = ImageOps.exif_transpose(im)
            up.info.setdefault("icc_profile", im.info.get("icc_profile"))
            if up.mode == "P":
                up = up.convert("RGBA" if "transparency" in up.info else "RGB")
            if up.mode in ("I;16", "I;16B", "I"):
                up = Image.fromarray((np.asarray(up) / 257).astype(np.uint8))
            raw = up.convert("RGB")
            return raw, to_srgb(up) if up.mode != "RGBA" else raw
    except Exception:
        return None


def arr(im):
    return np.asarray(im.convert("RGB"), dtype=np.float64)


def orientation(out_rgb, ref_raw):
    """Best of the 8 transforms of the output against the reference (MAD in 8-bit)."""
    best, cache = None, {}
    for name, t in TRANSFORMS.items():
        a = t(out_rgb)
        h, w = a.shape[:2]
        if abs(w / h - ref_raw.width / ref_raw.height) > 0.03:
            continue
        if (w, h) not in cache:
            cache[(w, h)] = arr(ref_raw.resize((w, h), Image.LANCZOS))
        r = cache[(w, h)]
        mad = float(np.abs(a - r).mean())
        if best is None or mad < best[1]:
            best = (name, mad)
    return best or ("aspect mismatch", None)


def quality(a, b):
    if a.shape != b.shape:
        return None
    ssim = structural_similarity(a, b, channel_axis=2, data_range=255)
    psnr = peak_signal_noise_ratio(a, b, data_range=255)
    return round(float(ssim), 4), (round(float(psnr), 2) if np.isfinite(psnr) else 99.0)


def delta_e(a, b):
    if a.shape != b.shape:
        return None
    de = deltaE_ciede2000(rgb2lab(a / 255), rgb2lab(b / 255))
    return round(float(de.mean()), 2), round(float(np.percentile(de, 95)), 2)


def one(path, rid):
    rec = {"file": rid, "bytes": path.stat().st_size}
    ref = reference(path)
    gt_name = GROUND_TRUTH.get(path.name)
    gt = reference(path.parent / gt_name)[1] if gt_name else None
    if ref:
        rec["source_size"] = list(ref[0].size)
    for r in (*TESTED, "vips_legacy"):
        od = OUT / r
        od.mkdir(parents=True, exist_ok=True)
        try:
            if r == "vips_legacy":  # big only, libwebp's default effort (pre-effort-2 renders)
                pyvips = _vips()
                try:
                    big = pyvips.Image.thumbnail(str(path), 10000, height=1080, size=pyvips.enums.Size.DOWN)
                except pyvips.Error:
                    from pipelines import _pillow_to_vips
                    big = _pillow_to_vips(path).thumbnail_image(10000, height=1080, size=pyvips.enums.Size.DOWN)
                big.webpsave(str(od / f"{rid}_big.webp"), Q=95)
                rec[r] = {"ok": True, "phash": phash(od / f"{rid}_big.webp")}
                continue
            used, procs = RENDERERS[r](path, od, rid)
            rec[r] = {"ok": True, "decoder": used, "procs": procs}
        except Exception as e:
            rec[r] = {"ok": False, "error": str(e).strip().splitlines()[-1][:300] if str(e).strip() else repr(e)}
            continue
        d = rec[r]
        d["sizes"] = {}
        for k in SIZES:
            with Image.open(od / f"{rid}_{k}.webp") as im:
                im.load()
                d["sizes"][k] = list(im.size)
                if k == "big":
                    d["mode"] = im.mode
                    d["icc"] = bool(im.info.get("icc_profile"))
                    d["exif"] = bool(im.info.get("exif"))
                    d["gps_in_exif"] = bool(im.getexif().get_ifd(0x8825)) if im.info.get("exif") else False
                    big_rgb = arr(im)
                    big_disp = arr(to_srgb(im))
            d[f"bytes_{k}"] = (od / f"{rid}_{k}.webp").stat().st_size
        d["phash"] = phash(od / f"{rid}_big.webp")
        if ref:
            d["orientation"], mad = orientation(big_rgb, ref[0])
            d["orientation_mad"] = None if mad is None else round(mad, 2)
            h, w = big_disp.shape[:2]
            truth = gt or ref[1]
            if abs(w / h - truth.width / truth.height) < 0.03:
                d["deltaE_vs_srgb_ref"] = delta_e(big_disp, arr(truth.resize((w, h), Image.LANCZOS)))
            d["vs_pillow"] = {}
            for k in SIZES:
                with Image.open(od / f"{rid}_{k}.webp") as im:
                    a = arr(im)
                q = quality(a, arr(ref[0].resize((a.shape[1], a.shape[0]), Image.LANCZOS)))
                d["vs_pillow"][k] = q
    v = rec.get("vips", {})
    for r in ("ffmpeg", "ffmpeg_yuv"):
        d = rec.get(r, {})
        if not (v.get("ok") and d.get("ok")):
            continue
        d["same_sizes_as_vips"] = d["sizes"] == v["sizes"]
        d["phash_bits_vs_vips"] = hamming(d["phash"], v["phash"])
        d["vs_vips"] = {}
        for k in SIZES:
            with Image.open(OUT / "vips" / f"{rid}_{k}.webp") as a, Image.open(OUT / r / f"{rid}_{k}.webp") as b:
                d["vs_vips"][k] = quality(arr(a), arr(b))
    if v.get("ok") and rec.get("vips_legacy", {}).get("ok"):
        rec["vips_legacy"]["phash_bits_vs_vips"] = hamming(rec["vips_legacy"]["phash"], v["phash"])
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default="")
    ap.add_argument("--merge", action="store_true", help="update matching records in matrix.json")
    args = ap.parse_args()
    files = sorted(p for p in CORPUS.rglob("*") if p.is_file() and args.only in p.name)
    out = []
    for p in files:
        rid = f"{p.parent.name}__{p.stem}_{p.suffix[1:]}"
        try:
            rec = one(p, rid)
        except Exception:
            rec = {"file": rid, "crash": traceback.format_exc()[-500:]}
        out.append(rec)
        print(json.dumps({k: rec.get(k) for k in ("file",)}),
              {r: (rec.get(r, {}).get("ok"), rec.get(r, {}).get("orientation"),
                   rec.get(r, {}).get("phash_bits_vs_vips")) for r in TESTED})
    if args.merge:
        old = json.loads((WORK / "matrix.json").read_text())
        new = {r["file"]: r for r in out}
        out = [new.pop(r["file"], r) for r in old] + list(new.values())
    (WORK / "matrix.json").write_text(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
