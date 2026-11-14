"""Synthetic DNG files for the RAW thumbnail goldens.

No camera RAWs are checked in (licensing), so the goldens run on DNGs written
here: a deterministic scene is taken to linear light, into a camera colour
space through a real-looking ColorMatrix1, white-balanced by AsShotNeutral,
mosaicked into an RGGB (or other) CFA with 14-bit black/white levels and
written as an uncompressed DNG. Variants cover every branch of
``image_decoding.raw_preview`` and the thumbnail service: a full-aspect JPEG
preview in IFD0 or in a SubIFD, a small bitmap thumbnail only, no preview, a
letterboxed or too small preview, EXIF orientation 6/8, a small sensor (full
size demosaic instead of half size) and an ActiveArea margin.

LibRaw (rawpy) reads all of them; see golden_raw_thumbnail.py.
"""

import io
import struct

import numpy as np
from PIL import Image, ImageDraw, ImageFont

# A Nikon-like XYZ -> camera matrix (the shape of Adobe's D850 ColorMatrix2).
COLOR_MATRIX = np.array(
    [[0.8261, -0.2716, -0.0268], [-0.4658, 1.2240, 0.2645], [-0.0879, 0.1570, 0.6937]]
)
XYZ_RGB = np.array(
    [[0.412453, 0.357580, 0.180423], [0.212671, 0.715160, 0.072169], [0.019334, 0.119193, 0.950227]]
)
CFA_COLORS = {"RGGB": (0, 1, 1, 2), "BGGR": (2, 1, 1, 0), "GRBG": (1, 0, 2, 1), "GBRG": (1, 2, 0, 1)}


def scene(width, height, seed=7):
    """An sRGB test scene: gradients, colour patches, fine lines, text, noise."""
    rng = np.random.default_rng(seed)
    x = np.linspace(0, 1, width, dtype=np.float32)
    y = np.linspace(0, 1, height, dtype=np.float32)
    r = np.tile(x, (height, 1))
    g = np.tile(y[:, None], (1, width))
    b = 1 - (r + g) / 2
    img = np.stack([r, g, b], -1) * 255
    im = Image.fromarray(img.astype(np.uint8), "RGB")
    d = ImageDraw.Draw(im)
    cw, ch = width // 8, height // 6
    patches = [
        (115, 82, 68), (194, 150, 130), (98, 122, 157), (87, 108, 67),
        (133, 128, 177), (103, 189, 170), (214, 126, 44), (80, 91, 166),
        (193, 90, 99), (94, 60, 108), (157, 188, 64), (224, 163, 46),
        (56, 61, 150), (70, 148, 73), (175, 54, 60), (231, 199, 31),
        (187, 86, 149), (8, 133, 161), (243, 243, 242), (200, 200, 200),
        (160, 160, 160), (122, 122, 121), (85, 85, 85), (52, 52, 52),
    ]
    for i, c in enumerate(patches):
        px, py = (i % 6) * cw + cw, (i // 6) * ch + ch
        d.rectangle([px, py, px + cw - 8, py + ch - 8], fill=c)
    for i in range(0, width, max(width // 200, 3)):
        d.line([(i, height - ch // 2), (i, height - 1)], fill=(0, 0, 0), width=1)
    try:
        font = ImageFont.truetype("arial.ttf", max(height // 14, 10))
    except OSError:
        font = ImageFont.load_default()
    d.text((cw // 2, ch // 6), "LibrePhotos RAW", fill=(255, 255, 255), font=font)
    arr = np.asarray(im).astype(np.float32)
    arr += rng.normal(0, 2.0, arr.shape).astype(np.float32)
    return np.clip(arr, 0, 255).astype(np.uint8)


def srgb_to_linear(u8):
    v = u8.astype(np.float64) / 255
    return np.where(v <= 0.04045, v / 12.92, ((v + 0.055) / 1.055) ** 2.4)


def mosaic(rgb_u8, pattern="RGGB", black=(512, 512, 512, 512), white=16383, exposure=0.55, seed=3):
    """sRGB scene -> 14-bit CFA values and the AsShotNeutral that balances them."""
    lin = srgb_to_linear(rgb_u8)
    cam_rgb = COLOR_MATRIX @ XYZ_RGB
    neutral = cam_rgb.sum(1)
    neutral = neutral / neutral.max()
    cam = lin @ cam_rgb.T  # H, W, 3 camera values, white = neutral
    colors = CFA_COLORS[pattern]
    h, w = cam.shape[:2]
    out = np.empty((h, w), np.float64)
    blk = np.empty((h, w), np.float64)
    for i, c in enumerate(colors):
        dy, dx = divmod(i, 2)
        out[dy::2, dx::2] = cam[dy::2, dx::2, c]
        blk[dy::2, dx::2] = black[i]
    rng = np.random.default_rng(seed)
    out = out * exposure * (white - max(black)) + blk
    out += rng.normal(0, 3.0, out.shape)
    return np.clip(np.round(out), 0, white).astype(np.uint16), neutral


def jpeg(rgb_u8, size, quality=90):
    im = Image.fromarray(rgb_u8, "RGB").resize(size, Image.LANCZOS)
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=quality)
    return buf.getvalue(), im


# ---- minimal TIFF writer -------------------------------------------------

BYTE, ASCII, SHORT, LONG, RATIONAL, UNDEFINED, SRATIONAL = 1, 2, 3, 4, 5, 7, 10


class Ifd:
    def __init__(self):
        self.tags = {}
        self.strip = None
        self.subs = []

    def set(self, tag, typ, values):
        self.tags[tag] = (typ, values)
        return self


def _encode(typ, values):
    if typ == ASCII:
        b = values.encode() + b"\0"
        return b, len(b)
    if typ in (RATIONAL, SRATIONAL):
        f = "<II" if typ == RATIONAL else "<ii"
        return b"".join(struct.pack(f, n, d) for n, d in values), len(values)
    fmt = {BYTE: "B", SHORT: "H", LONG: "I", UNDEFINED: "B"}[typ]
    return struct.pack(f"<{len(values)}{fmt}", *values), len(values)


def _rationals(vals, signed=False, den=10000):
    return [(int(round(v * den)), den) for v in vals]


def write_tiff(path, root):
    ifds = [root] + root.subs
    buf = bytearray(b"II*\0\0\0\0\0")
    for ifd in ifds:
        if ifd.strip is not None:
            if len(buf) % 2:
                buf += b"\0"
            ifd.set(273, LONG, [len(buf)]).set(279, LONG, [len(ifd.strip)])
            buf += ifd.strip
    if root.subs:
        root.set(330, LONG, [0] * len(root.subs))

    def size(ifd):
        n = 2 + 12 * len(ifd.tags) + 4
        for typ, vals in ifd.tags.values():
            data, _ = _encode(typ, vals)
            if len(data) > 4:
                n += len(data) + (len(data) % 2)
        return n

    offsets, pos = [], len(buf) + (len(buf) % 2)
    for ifd in ifds:
        offsets.append(pos)
        pos += size(ifd)
        pos += pos % 2
    if root.subs:
        root.set(330, LONG, offsets[1:])
    struct.pack_into("<I", buf, 4, offsets[0])
    for ifd, off in zip(ifds, offsets):
        buf += b"\0" * (off - len(buf))
        entries = sorted(ifd.tags.items())
        extra_at = off + 2 + 12 * len(entries) + 4
        head, extra = bytearray(struct.pack("<H", len(entries))), bytearray()
        for tag, (typ, vals) in entries:
            data, count = _encode(typ, vals)
            if len(data) <= 4:
                head += struct.pack("<HHI", tag, typ, count) + data.ljust(4, b"\0")
            else:
                head += struct.pack("<HHII", tag, typ, count, extra_at + len(extra))
                extra += data + b"\0" * (len(data) % 2)
        head += struct.pack("<I", 0)
        buf += head + extra
    with open(path, "wb") as f:
        f.write(buf)


def _raw_ifd(cfa_u16, pattern, black, white, active_area=None):
    h, w = cfa_u16.shape
    ifd = Ifd()
    ifd.set(254, LONG, [0]).set(256, LONG, [w]).set(257, LONG, [h])
    ifd.set(258, SHORT, [16]).set(259, SHORT, [1]).set(262, SHORT, [32803])
    ifd.set(277, SHORT, [1]).set(278, LONG, [h]).set(284, SHORT, [1])
    ifd.set(33421, SHORT, [2, 2]).set(33422, BYTE, list(CFA_COLORS[pattern]))
    ifd.set(50713, SHORT, [2, 2]).set(50714, LONG, list(black)).set(50717, LONG, [white])
    if active_area:
        ifd.set(50829, LONG, list(active_area))
    ifd.strip = cfa_u16.astype("<u2").tobytes()
    return ifd


def _linear_ifd(rgb_u8, channels, black, white):
    """A LinearRaw (already demosaiced) image: camera RGB, or one grey channel."""
    lin = srgb_to_linear(rgb_u8)
    if channels == 1:
        cam = (lin @ np.array([0.2126, 0.7152, 0.0722]))[..., None]
    else:
        cam = lin @ (COLOR_MATRIX @ XYZ_RGB).T
    rng = np.random.default_rng(5)
    out = cam * 0.55 * (white - black) + black + rng.normal(0, 3.0, cam.shape)
    out = np.clip(np.round(out), 0, white).astype(np.uint16)
    h, w = out.shape[:2]
    ifd = Ifd()
    ifd.set(254, LONG, [0]).set(256, LONG, [w]).set(257, LONG, [h])
    ifd.set(258, SHORT, [16] * channels).set(259, SHORT, [1]).set(262, SHORT, [34892])
    ifd.set(277, SHORT, [channels]).set(278, LONG, [h]).set(284, SHORT, [1])
    ifd.set(50713, SHORT, [1, 1]).set(50714, LONG, [black] * channels).set(50717, LONG, [white] * channels)
    ifd.strip = out.astype("<u2").tobytes()
    return ifd


def _dng_tags(ifd, neutral, orientation):
    ifd.set(271, ASCII, "LibrePhotos").set(272, ASCII, "Synthetic DNG")
    ifd.set(274, SHORT, [orientation])
    ifd.set(50706, BYTE, [1, 4, 0, 0]).set(50707, BYTE, [1, 1, 0, 0])
    ifd.set(50708, ASCII, "LibrePhotos Synthetic DNG")
    ifd.set(50721, SRATIONAL, _rationals(COLOR_MATRIX.flatten()))
    ifd.set(50728, RATIONAL, _rationals(neutral, den=1000000))
    ifd.set(50778, SHORT, [21])
    return ifd


def _preview_ifd(jpeg_bytes, size):
    ifd = Ifd()
    ifd.set(254, LONG, [1]).set(256, LONG, [size[0]]).set(257, LONG, [size[1]])
    ifd.set(258, SHORT, [8, 8, 8]).set(259, SHORT, [7]).set(262, SHORT, [6])
    ifd.set(277, SHORT, [3]).set(278, LONG, [size[1]]).set(284, SHORT, [1])
    ifd.strip = jpeg_bytes
    return ifd


def _bitmap_ifd(rgb_u8, size):
    im = np.asarray(Image.fromarray(rgb_u8, "RGB").resize(size, Image.BILINEAR))
    ifd = Ifd()
    ifd.set(254, LONG, [1]).set(256, LONG, [size[0]]).set(257, LONG, [size[1]])
    ifd.set(258, SHORT, [8, 8, 8]).set(259, SHORT, [1]).set(262, SHORT, [2])
    ifd.set(277, SHORT, [3]).set(278, LONG, [size[1]]).set(284, SHORT, [1])
    ifd.strip = im.tobytes()
    return ifd


def write_dng(
    path,
    rgb_u8,
    *,
    pattern="RGGB",
    black=(512, 512, 512, 512),
    white=16383,
    orientation=1,
    preview=None,  # None | ("ifd0" | "subifd", (w, h)) JPEG preview
    bitmap_thumb=None,  # (w, h) uncompressed IFD0 thumbnail
    active_area=None,  # (top, left, bottom, right); the scene fills the whole sensor
    linear=None,  # 3 (LinearRaw RGB) or 1 (monochrome) instead of a CFA
):
    if linear:
        neutral = (COLOR_MATRIX @ XYZ_RGB).sum(1)
        neutral = neutral / neutral.max()
        raw = _linear_ifd(rgb_u8, linear, black[0], white)
        cfa = np.array([white])
    else:
        cfa, neutral = mosaic(rgb_u8, pattern, black, white)
        raw = _raw_ifd(cfa, pattern, black, white, active_area)
    jpg = None
    if preview:
        where, size = preview
        data, _ = jpeg(rgb_u8, size)
        jpg = _preview_ifd(data, size)
    if jpg is not None and preview[0] == "ifd0":
        root = jpg
        root.subs = [raw]
    elif bitmap_thumb or jpg is not None:
        root = _bitmap_ifd(rgb_u8, bitmap_thumb or (256, 256 * rgb_u8.shape[0] // rgb_u8.shape[1]))
        root.subs = [raw] + ([jpg] if jpg is not None else [])
    else:
        root = raw
    _dng_tags(root, neutral, orientation)
    write_tiff(path, root)
    return {"neutral": neutral.tolist(), "cfa_max": int(cfa.max())}


# (name, sensor (w, h), options)
VARIANTS = [
    ("preview_ifd0", (3264, 2176), dict(preview=("ifd0", (1632, 1088)))),
    ("preview_subifd", (3264, 2176), dict(preview=("subifd", (1620, 1080)))),
    ("preview_rot6", (3264, 2176), dict(preview=("ifd0", (1632, 1088)), orientation=6)),
    ("preview_letterbox", (3264, 2176), dict(preview=("ifd0", (1920, 1080)))),
    ("preview_small", (3264, 2176), dict(preview=("ifd0", (640, 427)))),
    ("bitmap_thumb_only", (3264, 2176), dict(bitmap_thumb=(256, 171))),
    ("no_preview", (3264, 2176), dict(black=(512, 508, 516, 512))),
    ("no_preview_rot8", (3264, 2176), dict(orientation=8, pattern="BGGR")),
    ("no_preview_rot3_grbg", (3000, 2200), dict(orientation=3, pattern="GRBG")),
    ("small_sensor", (1500, 1000), dict(pattern="GBRG")),
    ("active_area", (3280, 2192), dict(active_area=(8, 8, 2184, 3272))),
    # Edge cases: mirrored orientations (LibRaw flips the render, Django leaves
    # a preview unrotated), odd and tiny sensors, a full 16-bit range, and
    # LinearRaw (demosaiced RGB and monochrome) DNGs.
    ("preview_mirror5", (3264, 2176), dict(preview=("ifd0", (1632, 1088)), orientation=5)),
    ("preview_rot8_tall", (3264, 2176), dict(preview=("subifd", (3264, 2176)), orientation=8)),
    ("no_preview_mirror2", (3264, 2176), dict(orientation=2)),
    ("no_preview_mirror7", (3264, 2176), dict(orientation=7, pattern="GBRG")),
    ("odd_sensor", (3001, 2163), dict(pattern="GRBG")),
    ("tiny_sensor", (64, 48), dict()),
    ("full_16bit", (3264, 2176), dict(black=(0, 0, 0, 0), white=65535)),
    ("linear_rgb", (3000, 2000), dict(linear=3)),
    ("linear_rgb_small", (900, 600), dict(linear=3)),
    ("mono_linear", (3000, 2000), dict(linear=1)),
    ("linear_rgb_big", (3600, 2400), dict(linear=3)),
    ("mono_linear_big", (3600, 2400), dict(linear=1)),
]


def generate(out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    made = []
    for name, (w, h), opts in VARIANTS:
        path = out_dir / f"{name}.dng"
        rgb = scene(w, h)
        info = {"sensor": [w, h], **{k: v for k, v in opts.items()}}
        if not path.exists():
            info.update(write_dng(path, rgb, **opts))
        made.append((path, info))
    return made
