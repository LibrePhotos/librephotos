"""local_orientation 2-8: render.rs `orient` (libvips rot/flip) vs the ffmpeg filters in
pipelines.LOCAL_ORIENTATION, on a 640x480 asymmetric image. Prints the mean absolute
difference per orientation (lossless PNG out, so 0 = identical geometry).

    python check_local_orientation.py
"""

import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

from common import CORPUS, FFMPEG
from pipelines import LOCAL_ORIENTATION, _vips

pyvips = _vips()
SRC = CORPUS / "gen" / "orient_1.jpg"


def vips_orient(img, o):
    H, V = pyvips.enums.Direction.HORIZONTAL, pyvips.enums.Direction.VERTICAL
    return {2: lambda: img.flip(H), 3: lambda: img.rot("d180"), 4: lambda: img.flip(V),
            5: lambda: img.rot("d90").flip(H), 6: lambda: img.rot("d270"),
            7: lambda: img.rot("d270").flip(H), 8: lambda: img.rot("d90")}[o]()


with tempfile.TemporaryDirectory() as d:
    d = Path(d)
    base = pyvips.Image.thumbnail(str(SRC), 10000, height=480).copy_memory()
    base.pngsave(str(d / "base.png"))
    for o, f in LOCAL_ORIENTATION.items():
        vips_orient(base, o).pngsave(str(d / f"v{o}.png"))
        subprocess.run([str(FFMPEG), "-v", "error", "-y", "-i", str(d / "base.png"), "-vf", f,
                        "-frames:v", "1", "-update", "1", str(d / f"f{o}.png")], check=True)
        a = np.asarray(Image.open(d / f"v{o}.png").convert("RGB"), float)
        b = np.asarray(Image.open(d / f"f{o}.png").convert("RGB"), float)
        print(o, f, a.shape, b.shape, "MAD", float(np.abs(a - b).mean()) if a.shape == b.shape else "shape differs")
