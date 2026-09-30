"""Goldens for the in-process RAW thumbnails (lp_ml::raw_thumbnail).

Runs Django's RAW path on the synthetic DNGs of raw_samples.py:
``api.image_decoding.raw_preview`` (the embedded JPEG, when usable) and, when
it declines, the thumbnail service's ``render_raw`` (rawpy postprocess ->
pyvips thumbnail -> WebP Q95), imported directly (no server).

Writes ``raw_thumbnail/big.json`` (per file: which path Python took, LibRaw's
sizes and flip, output dimensions) and next to the DNGs, in
``<goldens>/_raw/``: ``<name>.rawpy.png`` (rawpy's postprocess output, before
any resize), ``<name>.pre.png`` (the thumbnail's pixels before WebP) and
``<name>.py.png`` (the decoded WebP Python writes).
"""

import os
import tempfile

import golden_common as gc

gc.setup("service/thumbnail")

import numpy as np  # noqa: E402
import pyvips  # noqa: E402
import rawpy  # noqa: E402
from PIL import Image  # noqa: E402

import main as thumbnail_service  # noqa: E402  service/thumbnail/main.py
import raw_samples  # noqa: E402
from api import image_decoding  # noqa: E402

HEIGHT = 1080
RAW_DIR = gc.GOLDENS / "_raw"


def decoded(path):
    return np.asarray(Image.open(path).convert("RGB"))


def main():
    cases = []
    for path, info in raw_samples.generate(RAW_DIR):
        name = path.stem
        with rawpy.imread(str(path)) as raw:
            s = raw.sizes
            sizes = {"width": s.width, "height": s.height, "flip": s.flip}
            half = s.height // 2 >= HEIGHT
            rgb = raw.postprocess(use_camera_wb=True, half_size=half, output_bps=8)
        Image.fromarray(rgb).save(RAW_DIR / f"{name}.rawpy.png")

        preview = image_decoding.raw_preview(str(path), HEIGHT)
        fd, tmp = tempfile.mkstemp(suffix=".webp")
        os.close(fd)
        try:
            if preview is not None:
                choice = "preview"
                pre = preview.numpy()
                preview.write_to_file(tmp, Q=95, effort=2)
            else:
                choice = "render"
                # render_raw's pixels before its webpsave, then render_raw itself.
                pre = (
                    pyvips.Image.new_from_array(rgb)
                    .thumbnail_image(10000, height=HEIGHT, size=pyvips.enums.Size.DOWN)
                    .numpy()
                )
                thumbnail_service.render_raw(str(path), tmp, HEIGHT)
            out = decoded(tmp)
        finally:
            os.remove(tmp)
        Image.fromarray(out).save(RAW_DIR / f"{name}.py.png")
        Image.fromarray(np.ascontiguousarray(pre[..., :3])).save(RAW_DIR / f"{name}.pre.png")
        cases.append(
            gc.case(
                name,
                {"path": str(path), "height": HEIGHT, **info},
                {
                    "choice": choice,
                    "sizes": sizes,
                    "half": half,
                    "rawpy_shape": list(rgb.shape),
                    "thumbnail_shape": list(out.shape),
                },
            )
        )
        print(name, choice, sizes, "half" if half else "full", rgb.shape, "->", out.shape)
    gc.write(
        "raw_thumbnail",
        "big",
        cases,
        meta={
            "rawpy": rawpy.__version__,
            "libraw": ".".join(map(str, rawpy.libraw_version)),
            "libvips": f"{pyvips.version(0)}.{pyvips.version(1)}.{pyvips.version(2)}",
            "images": str(RAW_DIR),
        },
    )


if __name__ == "__main__":
    main()
