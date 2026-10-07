"""Build the thumbnail test corpus under $LP_THUMBS_WORK/corpus (deterministic).

Sources: the Rust fixture library (rust-pg/fixture/data), deploy/e2e/photos, the
E2E-ML check library (rust-pg/e2e-ml/lib/mlcheck, scikit-image sample photos), plus
generated edge cases. Generated "photos" are mosaics of the scikit-image sample
photographs, upscaled, with sensor-like grain, a zone plate and fine text, so the
resamplers have real high-frequency content to disagree about.

    python make_corpus.py
"""

import io
import random
import shutil
import struct
import subprocess
from pathlib import Path

import numpy as np
import pillow_heif
import pillow_jxl  # noqa: F401  registers JPEG XL
from PIL import Image, ImageCms, ImageDraw, ImageFont

from common import CORPUS, FFMPEG, LIBREPHOTOS, REPO

pillow_heif.register_heif_opener()
Image.MAX_IMAGE_PIXELS = None

FIXTURE = LIBREPHOTOS / "rust-pg" / "fixture" / "data"
MLCHECK = LIBREPHOTOS / "rust-pg" / "e2e-ml" / "lib" / "mlcheck"
E2E = REPO / "deploy" / "e2e" / "photos"
SK = Path(__import__("skimage").__file__).parent / "data"
RSWOP = Path("C:/Windows/System32/spool/drivers/color/RSWOP.icm")


# --------------------------------------------------------------------- ICC

def _s15(x):
    return struct.pack(">i", round(x * 65536))


def adobe_rgb_icc():
    """A minimal ICC v2 matrix/TRC profile for Adobe RGB (1998), gamma 563/256."""
    def xyz(x, y, z):
        return b"XYZ " + b"\0" * 4 + _s15(x) + _s15(y) + _s15(z)

    def curv(g):
        return b"curv" + b"\0" * 4 + struct.pack(">I", 1) + struct.pack(">H", round(g * 256)) + b"\0\0"

    def desc(s):
        s = s.encode() + b"\0"
        return (b"desc" + b"\0" * 4 + struct.pack(">I", len(s)) + s + b"\0" * 4 + b"\0" * 4
                + b"\0" * 3 + b"\0" * 67)

    def text(s):
        return b"text" + b"\0" * 4 + s.encode() + b"\0"

    tags = [
        (b"desc", desc("Adobe RGB (1998) compatible")),
        (b"cprt", text("Public domain, generated for a benchmark")),
        (b"wtpt", xyz(0.96420, 1.0, 0.82491)),
        (b"rXYZ", xyz(0.60974, 0.31111, 0.01947)),
        (b"gXYZ", xyz(0.20528, 0.62567, 0.06087)),
        (b"bXYZ", xyz(0.14919, 0.06322, 0.74457)),
        (b"rTRC", curv(2.19921875)),
        (b"gTRC", curv(2.19921875)),
        (b"bTRC", curv(2.19921875)),
    ]
    off = 128 + 4 + 12 * len(tags)
    table, data = b"", b""
    for sig, body in tags:
        while (off + len(data)) % 4:
            data += b"\0"
        table += sig + struct.pack(">II", off + len(data), len(body))
        data += body
    body = struct.pack(">I", len(tags)) + table + data
    size = 128 + len(body)
    hdr = (struct.pack(">I", size) + b"none" + bytes([2, 0x10, 0, 0]) + b"mntr" + b"RGB " + b"XYZ "
           + b"\0" * 12 + b"acsp" + b"\0" * 4 + b"\0" * 4 + b"\0" * 8 + b"\0" * 8 + b"\0" * 4
           + _s15(0.9642) + _s15(1.0) + _s15(0.8249) + b"\0" * 4 + b"\0" * 16 + b"\0" * 28)
    assert len(hdr) == 128, len(hdr)
    return hdr + body


# ----------------------------------------------------------------- content

def _sources():
    names = ["astronaut.png", "coffee.png", "chelsea.png", "rocket.jpg", "hubble_deep_field.jpg",
             "motorcycle_left.png", "retina.jpg", "horse.png", "color.png", "grass.png", "gravel.png"]
    out = []
    for n in names:
        im = Image.open(SK / n)
        out.append(im.convert("RGB"))
    return out


def zone_plate(n):
    y, x = np.mgrid[-n / 2:n / 2, -n / 2:n / 2]
    z = 0.5 + 0.5 * np.cos(np.pi * (x * x + y * y) / n)
    return Image.fromarray((z * 255).astype(np.uint8)).convert("RGB")


def photo(w, h, seed):
    """A photo-like RGB image: a mosaic of real photos, grain, a zone plate, text."""
    rng = random.Random(seed)
    srcs = _sources()
    rng.shuffle(srcs)
    canvas = Image.new("RGB", (w, h))
    cols = max(2, round(w / h * 2))
    rows = 2
    cw, ch = -(-w // cols), -(-h // rows)
    i = 0
    for r in range(rows):
        for c in range(cols):
            tile = srcs[i % len(srcs)].resize((cw, ch), Image.BICUBIC)
            canvas.paste(tile, (c * cw, r * ch))
            i += 1
    zp = min(w, h) // 4
    canvas.paste(zone_plate(zp), (w // 2 - zp // 2, h // 2 - zp // 2))
    d = ImageDraw.Draw(canvas)
    try:
        font = ImageFont.truetype("arial.ttf", max(12, h // 120))
    except OSError:
        font = ImageFont.load_default()
    for k in range(6):
        d.text((40, 40 + k * (h // 100)), f"LibrePhotos thumbnail benchmark {seed} line {k} 0123456789",
               fill=(255, 255, 255), font=font)
    for k in range(0, w, max(8, w // 300)):  # fine vertical lines in a band
        d.line([(k, h - h // 12), (k, h - h // 24)], fill=(20, 20, 20), width=1)
    arr = np.asarray(canvas).astype(np.int16)
    grain = np.random.default_rng(seed).normal(0, 5, arr.shape)
    arr = np.clip(arr + grain, 0, 255).astype(np.uint8)
    return Image.fromarray(arr)


def asymmetric(w, h):
    """An image whose orientation is unambiguous: coloured corners + an arrow."""
    im = photo(w, h, 7)
    d = ImageDraw.Draw(im)
    s = h // 5
    d.rectangle([0, 0, s, s], fill=(255, 0, 0))            # top-left red
    d.rectangle([w - s, 0, w, s], fill=(0, 255, 0))        # top-right green
    d.rectangle([0, h - s, s, h], fill=(0, 0, 255))        # bottom-left blue
    d.polygon([(w // 2, h // 10), (w // 2 - s // 2, h // 10 + s), (w // 2 + s // 2, h // 10 + s)],
              fill=(255, 255, 0))                          # arrow pointing up
    return im


# Pixel transform that, followed by exif_transpose, gives back the upright image.
INVERSE = {
    1: lambda im: im,
    2: lambda im: im.transpose(Image.FLIP_LEFT_RIGHT),
    3: lambda im: im.transpose(Image.ROTATE_180),
    4: lambda im: im.transpose(Image.FLIP_TOP_BOTTOM),
    5: lambda im: im.transpose(Image.TRANSPOSE),
    6: lambda im: im.transpose(Image.ROTATE_90),
    7: lambda im: im.transpose(Image.TRANSVERSE),
    8: lambda im: im.transpose(Image.ROTATE_270),
}


def exif_bytes(orientation=1):
    e = Image.Exif()
    e[0x010F] = "BenchCam"
    e[0x0110] = "Model 1"
    e[0x0112] = orientation
    return e.tobytes()


def main():
    if CORPUS.exists():
        shutil.rmtree(CORPUS)
    for sub in ("fixture", "mlcheck", "gen"):
        (CORPUS / sub).mkdir(parents=True)

    # Existing libraries (unique by content).
    seen = set()
    for src, sub in ((FIXTURE, "fixture"), (E2E, "fixture"), (MLCHECK, "mlcheck")):
        for p in sorted(src.rglob("*")):
            if not p.is_file() or p.suffix.lower() not in (".jpg", ".jpeg", ".png", ".heic", ".dng"):
                continue
            data = p.read_bytes()
            key = hash(data)
            if key in seen:
                continue
            seen.add(key)
            name = p.relative_to(src).as_posix().replace("/", "__")
            name = "".join(ch if ch.isascii() and (ch.isalnum() or ch in "._-") else "_" for ch in name)
            (CORPUS / sub / name).write_bytes(data)

    g = CORPUS / "gen"
    phone = photo(4032, 3024, 1)
    phone.save(g / "jpeg_12mp.jpg", quality=90, exif=exif_bytes(1))
    big = photo(6000, 4000, 2)
    big.save(g / "jpeg_24mp.jpg", quality=92, exif=exif_bytes(1))
    big.save(g / "jpeg_24mp_444.jpg", quality=95, subsampling=0)
    phone.save(g / "jpeg_progressive.jpg", quality=88, progressive=True, optimize=True)
    photo(12000, 2000, 3).save(g / "panorama_12000x2000.jpg", quality=90)

    up = asymmetric(1600, 1200)
    for o in range(1, 9):
        INVERSE[o](up).save(g / f"orient_{o}.jpg", quality=92, exif=exif_bytes(o))
    INVERSE[6](phone).save(g / "orient_6_12mp.jpg", quality=90, exif=exif_bytes(6))

    # Colour management.
    mid = photo(3000, 2000, 4)
    cmyk_profile = ImageCms.getOpenProfile(str(RSWOP))
    srgb = ImageCms.createProfile("sRGB")
    cmyk = ImageCms.profileToProfile(mid, srgb, cmyk_profile, outputMode="CMYK")
    cmyk.save(g / "cmyk_swop.jpg", quality=92, icc_profile=RSWOP.read_bytes())
    adobe = adobe_rgb_icc()
    ImageCms.ImageCmsProfile(io.BytesIO(adobe))  # validates the profile
    # The same scene stored in Adobe RGB: correct rendering needs the profile.
    mid_adobe = ImageCms.profileToProfile(mid, srgb, ImageCms.ImageCmsProfile(io.BytesIO(adobe)))
    mid_adobe.save(g / "adobergb_icc.jpg", quality=92, icc_profile=adobe)
    # png_rgb.png (below) is the sRGB ground truth of adobergb_icc.jpg

    # Bit depth, alpha, grey.
    a16 = (np.asarray(mid).astype(np.uint16) * 257)
    a16[..., 0] = np.clip(a16[..., 0].astype(np.int32) + np.random.default_rng(5).integers(0, 200, a16.shape[:2]),
                          0, 65535).astype(np.uint16)
    subprocess.run([str(FFMPEG), "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb48le", "-s", "3000x2000",
                    "-i", "-", "-frames:v", "1", str(g / "png16_rgb.png")], input=a16.astype("<u2").tobytes(),
                   check=True)
    rgba = mid.convert("RGBA")
    alpha = Image.linear_gradient("L").resize(mid.size)
    alpha.paste(0, (0, 0, 600, 600))  # a fully transparent corner
    rgba.putalpha(alpha)
    rgba.save(g / "png_alpha.png")
    mid.save(g / "png_rgb.png", compress_level=6)
    mid.convert("L").save(g / "gray.jpg", quality=92)
    mid.convert("P", palette=Image.ADAPTIVE).save(g / "png_palette.png")

    # Other containers.
    mid.save(g / "webp_lossy.webp", quality=90)
    mid.save(g / "avif.avif", quality=80)
    mid.save(g / "jxl.jxl", quality=90)
    mid.save(g / "tiff_lzw.tif", compression="tiff_lzw")
    INVERSE[6](mid).save(g / "tiff_orient6.tif", compression="tiff_lzw", exif=exif_bytes(6))
    frames = [photo(800, 600, 10 + k) for k in range(3)]
    frames[0].save(g / "gif_anim.gif", save_all=True, append_images=frames[1:], duration=200, loop=0)
    # HEIC: iPhone-like 512 px tile grid, and an orientation stored as irot.
    phone.save(g / "heic_grid_12mp.heic", quality=80, tile_size=512)
    mid.save(g / "heic_single.heic", quality=80)
    INVERSE[6](mid).save(g / "heic_orient6.heic", quality=80, exif=exif_bytes(6))
    # iPhone portrait: grid + irot + EXIF Orientation 6 (must not rotate twice).
    INVERSE[6](phone).save(g / "heic_grid_orient6.heic", quality=80, tile_size=512, exif=exif_bytes(6))
    phone.save(g / "heic_grid_12mp_adobeicc.heic", quality=80, tile_size=512, icc_profile=adobe)

    # Degenerate.
    photo(64, 64, 6).resize((16, 16)).save(g / "tiny_16x16.png")
    photo(64, 64, 6).resize((16, 16)).save(g / "tiny_16x16.jpg", quality=90)
    data = (g / "jpeg_12mp.jpg").read_bytes()
    (g / "truncated_60pct.jpg").write_bytes(data[: int(len(data) * 0.6)])
    photo(1001, 777, 8).save(g / "odd_1001x777.jpg", quality=90)

    total = sum(p.stat().st_size for p in CORPUS.rglob("*") if p.is_file())
    print(f"{sum(1 for p in CORPUS.rglob('*') if p.is_file())} files, {total / 1e6:.1f} MB in {CORPUS}")


if __name__ == "__main__":
    main()
