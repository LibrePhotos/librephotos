"""Edge-case preprocessing goldens for lp_ml::caption (no model needed).

    python golden_caption_edge.py

Writes ml-goldens/caption/prepare_edge.json: for image modes and containers
the fixture does not cover (palette, LA, 16-bit, CMYK, EXIF-rotated, 1-bit,
GIF, TIFF, BMP, lossless/alpha WebP, an exact 512x512 and a very tall strip)
the RGB pixels ``Image.open(p).convert("RGB")`` gives and the patch tensor of
``lfm2_vl.prepare_image``. The Rust test compares both, so a decode
difference is told apart from a resize or normalisation one.
"""

import golden_common as gc

gc.setup("service/image_captioning")

import numpy as np  # noqa: E402
from lfm2_vl import prepare_image, smart_resize  # noqa: E402
from PIL import Image  # noqa: E402


def gradient(w, h):
    x = np.linspace(0, 255, w, dtype=np.float32)
    y = np.linspace(0, 255, h, dtype=np.float32)
    r = np.tile(x, (h, 1))
    g = np.tile(y[:, None], (1, w))
    b = (r + g) / 2
    return Image.fromarray(np.stack([r, g, b], -1).astype(np.uint8), "RGB")


def edge_images():
    import cv2

    d = gc.GOLDENS / "_images" / "caption_edge"
    d.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(20260930)

    def save(name, fn):
        p = d / name
        if not p.exists():
            fn(p)
        return p

    out = []
    out.append(
        save(
            "palette_trans_300x200.png",
            lambda p: gradient(300, 200)
            .convert("P", palette=Image.ADAPTIVE, colors=64)
            .save(p, transparency=3),
        )
    )
    out.append(
        save(
            "la_200x150.png",
            lambda p: Image.merge(
                "LA",
                (gradient(200, 150).convert("L"), Image.new("L", (200, 150), 128)),
            ).save(p),
        )
    )
    out.append(
        save(
            "gray16_240x180.png",
            lambda p: Image.fromarray(
                (np.linspace(0, 65535, 240 * 180).reshape(180, 240)).astype(np.uint16)
            ).save(p),
        )
    )
    out.append(
        save(
            "rgb16_240x180.png",
            lambda p: cv2.imwrite(
                str(p), rng.integers(0, 65536, (180, 240, 3), dtype=np.uint16)
            ),
        )
    )
    out.append(
        save(
            "cmyk_320x240.jpg",
            lambda p: gradient(320, 240).convert("CMYK").save(p, quality=95),
        )
    )
    out.append(
        save(
            "gray_320x240.jpg",
            lambda p: gradient(320, 240).convert("L").save(p, quality=95),
        )
    )

    def rotated(p, fmt):
        img = gradient(400, 300)
        exif = Image.Exif()
        exif[0x0112] = 6
        img.save(p, format=fmt, exif=exif.tobytes(), **({"quality": 95} if fmt == "JPEG" else {"lossless": True}))

    out.append(save("exif_rot6_400x300.jpg", lambda p: rotated(p, "JPEG")))
    out.append(save("exif_rot6_400x300.webp", lambda p: rotated(p, "WEBP")))
    out.append(
        save(
            "bilevel_300x200.png",
            lambda p: gradient(300, 200).convert("L").convert("1").save(p),
        )
    )
    out.append(
        save(
            "anim_160x120.gif",
            lambda p: gradient(160, 120)
            .convert("P")
            .save(
                p,
                save_all=True,
                append_images=[Image.new("P", (160, 120), 7)],
                duration=100,
            ),
        )
    )
    out.append(save("rgb_300x220.tif", lambda p: gradient(300, 220).save(p)))
    out.append(save("rgb_300x220.bmp", lambda p: gradient(300, 220).save(p)))
    out.append(
        save(
            "rgba_alpha_320x240.webp",
            lambda p: Image.merge(
                "RGBA",
                (*gradient(320, 240).split(), gradient(320, 240).convert("L")),
            ).save(p, quality=80),
        )
    )
    out.append(
        save("lossless_320x240.webp", lambda p: gradient(320, 240).save(p, lossless=True))
    )
    out.append(save("exact_512x512.png", lambda p: gradient(512, 512).save(p)))
    out.append(save("tall_20x3000.png", lambda p: gradient(20, 3000).save(p)))
    out.append(save("odd_3x2.png", lambda p: gradient(3, 2).save(p)))
    return out


def main():
    cases = []
    for p in edge_images():
        with Image.open(p) as im:
            mode = im.mode
            w, h = im.size
            rgb = np.asarray(im.convert("RGB"), dtype=np.uint8)
            pixel_values, spatial, _ = prepare_image(im)
        new_h, new_w = smart_resize(h, w)
        cases.append(
            gc.case(
                p,
                {"image": str(p)},
                {
                    "mode": mode,
                    "size": [w, h],
                    "resized": [new_w, new_h],
                    "spatial_shapes": spatial.tolist()[0],
                    "rgb": gc.arr(rgb),
                    "pixel_values": gc.arr(pixel_values[0]),
                },
            )
        )
        print(f"{p.name}: {mode} {w}x{h} -> {new_w}x{new_h}")
    gc.write("caption", "prepare_edge", cases, meta={"model": "lfm2_vl_450m"})


if __name__ == "__main__":
    main()
