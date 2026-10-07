"""The three thumbnail renderers under test, each writing big/m/s WebPs.

- ``vips``: what lp-ingest (and api/thumbnails.py) does: ``thumbnail(path, 10000,
  height=1080, size=down)`` (autorotate), WebP Q95 effort 2; 500 / 250 resized from
  the in-memory big image with ``thumbnail_image``. Files libvips rejects (HEIC on
  pyvips-binary, JPEG XL) go through Pillow + pillow-heif/jxl, EXIF-transposed, RGB.
- ``ffmpeg``: one ffmpeg process per image, the big frame split into the two smaller
  sizes (``ffmpeg_cmd``). ``ffmpeg_3proc`` = three processes, the smaller two read
  back from big.webp as api/thumbnails.py does.

    python pipelines.py <image> <outdir> [vips|ffmpeg|ffmpeg_yuv|ffmpeg_3proc]
"""

import subprocess
import sys
from pathlib import Path

from common import FFMPEG, HEIGHTS, WEBP_EFFORT, WEBP_Q

SIZES = ("big", "m", "s")

# ------------------------------------------------------------------ libvips

_pyvips = None


def _vips():
    global _pyvips
    if _pyvips is None:
        import pyvips

        pyvips.cache_set_max(0)  # lp-ingest disables the operation cache too
        _pyvips = pyvips
    return _pyvips


def _pillow_to_vips(path):
    import numpy as np
    import pillow_heif
    import pillow_jxl  # noqa: F401
    from PIL import Image, ImageOps

    pillow_heif.register_heif_opener()
    Image.MAX_IMAGE_PIXELS = 250_000_000
    with Image.open(path) as image:
        image = ImageOps.exif_transpose(image).convert("RGB")
        return _vips().Image.new_from_array(np.asarray(image))


def vips_render(path, outdir, stem="t"):
    """Returns the decoder used ('vips' or 'pillow')."""
    pyvips = _vips()
    down = pyvips.enums.Size.DOWN
    try:
        big = pyvips.Image.thumbnail(str(path), 10000, height=HEIGHTS["big"], size=down).copy_memory()
        used = "vips"
    except pyvips.Error:
        big = _pillow_to_vips(path).thumbnail_image(10000, height=HEIGHTS["big"], size=down).copy_memory()
        used = "pillow"
    outdir = Path(outdir)
    big.webpsave(str(outdir / f"{stem}_big.webp"), Q=WEBP_Q, effort=WEBP_EFFORT)
    for k in ("m", "s"):
        big.thumbnail_image(10000, height=HEIGHTS[k], size=down).webpsave(
            str(outdir / f"{stem}_{k}.webp"), Q=WEBP_Q, effort=WEBP_EFFORT)
    return used


# ------------------------------------------------------------------- ffmpeg

# libvips' size rule: height min(ih, H), width keeping the aspect, never upscaled.
def _box(h):
    return f"w='if(gt(ih,{h}),max(1,round(iw*{h}/ih)),iw)':h='min(ih,{h})'"


SCALE_FLAGS = "lanczos+accurate_rnd+full_chroma_int+full_chroma_inp"
WEBP_ARGS = ["-c:v", "libwebp", "-quality", str(WEBP_Q), "-compression_level", str(WEBP_EFFORT),
             "-frames:v", "1", "-update", "1", "-f", "webp"]


def _graph(src, rgb=True):
    """big from the decoded frame, m and s from big (as libvips does)."""
    pre = "format=pix_fmts=rgb24|rgba|rgb48le|rgba64le," if rgb else ""
    post = "format=pix_fmts=bgra" if rgb else "format=pix_fmts=yuv420p|yuva420p"
    return (f"{src}{pre}scale={_box(HEIGHTS['big'])}:flags={SCALE_FLAGS},split=3[b0][m0][s0];"
            f"[b0]{post}[big];"
            f"[m0]scale={_box(HEIGHTS['m'])}:flags={SCALE_FLAGS},{post}[m];"
            f"[s0]scale={_box(HEIGHTS['s'])}:flags={SCALE_FLAGS},{post}[s]")


def ffmpeg_cmd(path, outdir, stem="t", grid=False, rgb=True, extra=()):
    outdir = Path(outdir)
    src = "[0:g:0]" if grid else "[0:v:0]"
    cmd = [str(FFMPEG), "-hide_banner", "-v", "error", "-nostdin", "-y", *extra, "-i", str(path),
           "-filter_complex", _graph(src, rgb)]
    for k in SIZES:
        cmd += ["-map", f"[{k}]", *WEBP_ARGS, str(outdir / f"{stem}_{k}.webp")]
    return cmd


HEIF_EXT = {".heic", ".heif", ".avif", ".hif"}


def ffmpeg_render(path, outdir, stem="t", rgb=True, extra=()):
    """One process; HEIF-family files try the tile grid first (iPhone HEICs are grids).
    Returns (decoder label, number of processes)."""
    procs = 0
    if Path(path).suffix.lower() in HEIF_EXT:
        procs += 1
        r = subprocess.run(ffmpeg_cmd(path, outdir, stem, grid=True, rgb=rgb, extra=extra),
                           capture_output=True)
        if r.returncode == 0:
            return "ffmpeg-grid", procs
    procs += 1
    r = subprocess.run(ffmpeg_cmd(path, outdir, stem, rgb=rgb, extra=extra), capture_output=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode("utf8", "replace").strip()[-400:])
    return "ffmpeg", procs


def ffmpeg_3proc(path, outdir, stem="t"):
    """big from the original, then m and s each read back from big.webp (3 processes)."""
    outdir = Path(outdir)
    big = outdir / f"{stem}_big.webp"
    procs = 0
    srcs = ["[0:g:0]", "[0:v:0]"] if Path(path).suffix.lower() in HEIF_EXT else ["[0:v:0]"]
    for src in srcs:
        procs += 1
        g = f"{src}format=pix_fmts=rgb24|rgba|rgb48le|rgba64le,scale={_box(1080)}:flags={SCALE_FLAGS},format=bgra[o]"
        r = subprocess.run([str(FFMPEG), "-hide_banner", "-v", "error", "-nostdin", "-y", "-i", str(path),
                            "-filter_complex", g, "-map", "[o]", *WEBP_ARGS, str(big)], capture_output=True)
        if r.returncode == 0:
            break
    else:
        raise RuntimeError(r.stderr.decode("utf8", "replace").strip()[-400:])
    for k in ("m", "s"):
        procs += 1
        g = f"[0:v:0]format=pix_fmts=rgba,scale={_box(HEIGHTS[k])}:flags={SCALE_FLAGS},format=bgra[o]"
        subprocess.run([str(FFMPEG), "-hide_banner", "-v", "error", "-nostdin", "-y", "-i", str(big),
                        "-filter_complex", g, "-map", "[o]", *WEBP_ARGS, str(outdir / f"{stem}_{k}.webp")],
                       check=True, capture_output=True)
    return "ffmpeg", procs


RENDERERS = {
    "vips": lambda p, o, s="t": (vips_render(p, o, s), 0),
    "ffmpeg": lambda p, o, s="t": ffmpeg_render(p, o, s, rgb=True),
    "ffmpeg_yuv": lambda p, o, s="t": ffmpeg_render(p, o, s, rgb=False),
    "ffmpeg_3proc": ffmpeg_3proc,
}

if __name__ == "__main__":
    img, out, how = sys.argv[1], sys.argv[2], (sys.argv[3] if len(sys.argv) > 3 else "ffmpeg")
    Path(out).mkdir(parents=True, exist_ok=True)
    print(RENDERERS[how](img, out))


# local_orientation (render.rs `orient`, pyvips conventions: D90 = clockwise) as
# ffmpeg filters, appended after the big scale. Checked by check_local_orientation.py.
LOCAL_ORIENTATION = {
    2: "hflip", 3: "hflip,vflip", 4: "vflip", 5: "transpose=clock,hflip",
    6: "transpose=cclock", 7: "transpose=cclock,hflip", 8: "transpose=clock",
}
