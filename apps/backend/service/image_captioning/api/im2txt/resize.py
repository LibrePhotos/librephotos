import os

from PIL import Image

image_dir = "api/im2txt/data/train2014/"
output_dir = "api/im2txt/data/resized2014/"
image_size = 256


def resize_image(image, size):
    """Resize an image to the given size."""
    return image.resize(size, Image.ANTIALIAS)


def resize_images(image_dir, output_dir, size):
    """Resize the images in 'image_dir' and save into 'output_dir'."""
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    images = os.listdir(image_dir)
    num_images = len(images)
    for i, image in enumerate(images):
        with open(os.path.join(image_dir, image), "r+b") as f:
            with Image.open(f) as img:
                img = resize_image(img, size)
                img.save(os.path.join(output_dir, image), img.format)
        if (i + 1) % 100 == 0:
            print(
                f"[{i + 1}/{num_images}] Resized the images and saved into '{output_dir}'."
            )


def main():
    resize_images(image_dir, output_dir, [image_size, image_size])
