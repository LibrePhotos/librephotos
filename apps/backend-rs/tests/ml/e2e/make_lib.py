"""Build the E2E ML photo library from images already on this machine.

Faces: insightface's t1 (6 people), Tom Hanks, skimage's astronaut and
cameraman, the mask samples, each in several variants so clustering has
several faces per identity. Scenes: skimage / sklearn samples. Text: the OCR
golden documents and some bench text cards.
"""

import glob
import os
import sys

import insightface
import sklearn
import skimage
from PIL import Image, ImageEnhance, ImageOps

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
INS = os.path.join(os.path.dirname(insightface.__file__), "data", "images")
SK = os.path.join(os.path.dirname(skimage.__file__), "data")
SKL = os.path.join(os.path.dirname(sklearn.__file__), "datasets", "images")
RUST_PG = os.environ.get("LP_RUST_PG", "C:/Users/Niaz/librephotos/rust-pg")
GOLD = f"{RUST_PG}/ml-goldens/_images"
BENCH = f"{RUST_PG}/bench-scan/lib"

n = 0


def save(img, name):
    global n
    img = img.convert("RGB")
    img.save(os.path.join(OUT, name + ".jpg"), quality=92)
    n += 1


def pad(img, f=1.8, color=(200, 200, 190)):
    w, h = img.size
    c = Image.new("RGB", (int(w * f), int(h * f)), color)
    c.paste(img.convert("RGB"), ((c.width - w) // 2, (c.height - h) // 3))
    return c


def variants(img, stem, crops=True):
    w, h = img.size
    save(img, f"{stem}_orig")
    save(ImageOps.mirror(img), f"{stem}_flip")
    save(img.resize((int(w * 1.5), int(h * 1.5)), Image.LANCZOS), f"{stem}_big")
    save(ImageEnhance.Brightness(img).enhance(1.25), f"{stem}_bright")
    save(pad(img), f"{stem}_padded")
    if crops:
        save(img.crop((0, 0, int(w * 0.6), h)), f"{stem}_left")
        save(img.crop((int(w * 0.4), 0, w, h)), f"{stem}_right")
        save(ImageOps.grayscale(img), f"{stem}_grey")


variants(Image.open(os.path.join(INS, "t1.jpg")), "group_t1")
variants(Image.open(os.path.join(INS, "Tom_Hanks_54745.png")), "portrait_hanks", crops=False)
variants(Image.open(os.path.join(SK, "astronaut.png")), "portrait_astronaut", crops=False)
for m in ("black", "blue", "green", "white"):
    save(Image.open(os.path.join(INS, f"mask_{m}.jpg")), f"mask_{m}")
cam = Image.open(os.path.join(SK, "camera.png"))
save(cam, "cameraman")
save(ImageOps.mirror(cam), "cameraman_flip")

for f in ("coffee.png", "chelsea.png", "rocket.jpg", "hubble_deep_field.jpg",
          "motorcycle_left.png", "coins.png", "retina.jpg", "brick.png", "grass.png",
          "horse.png", "logo.png", "color.png", "moon.png", "ihc.png", "clock_motion.png"):
    save(Image.open(os.path.join(SK, f)), "scene_" + os.path.splitext(f)[0])
for f in ("china.jpg", "flower.jpg"):
    save(Image.open(os.path.join(SKL, f)), "scene_" + os.path.splitext(f)[0])

for f in ("page.png", "text.png"):
    save(Image.open(os.path.join(SK, f)), "text_" + os.path.splitext(f)[0])
for f in ("document_1240x1754.jpg", "receipt_720x1100.png", "sign_900x500.jpg",
          "poster_1400x900.webp", "columns_1200x700.png", "rotated_1000x800.png",
          "lowcontrast_900x400.png", "big_2600x1800.png"):
    save(Image.open(os.path.join(GOLD, "ocr", f)), "text_" + os.path.splitext(f)[0])
cards = sorted(glob.glob(os.path.join(BENCH, "*", "*", "*.jpg")))[::130][:15]
for i, f in enumerate(cards):
    im = Image.open(f)
    im.thumbnail((1600, 1600))
    save(im, f"card_{i:02d}")

print(n, "images in", OUT)
