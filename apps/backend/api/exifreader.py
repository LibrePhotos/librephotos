import PIL

import api.util as util


def rotate_image(image):
    # If no ExifTags, no rotating needed.
    try:
        # Grab orientation value.
        ORIENTATION_KEY = 274
        image_exif = image._getexif()
        if(image_exif and ORIENTATION_KEY in image_exif):
            image_orientation = image_exif[ORIENTATION_KEY]

            # Rotate depending on orientation.
            if image_orientation == 2:
                image = image.transpose(PIL.Image.FLIP_LEFT_RIGHT)
            if image_orientation == 3:
                image = image.transpose(PIL.Image.ROTATE_180)
            if image_orientation == 4:
                image = image.transpose(PIL.Image.FLIP_TOP_BOTTOM)
            if image_orientation == 5:
                image = image.transpose(PIL.Image.FLIP_LEFT_RIGHT).transpose(
                PIL.Image.ROTATE_90)
            if image_orientation == 6:
                image = image.transpose(PIL.Image.ROTATE_270)
            if image_orientation == 7:
                image = image.transpose(PIL.Image.FLIP_TOP_BOTTOM).transpose(
                PIL.Image.ROTATE_90)
            if image_orientation == 8:
                image = image.transpose(PIL.Image.ROTATE_90)
    except:
        util.logger.exception("Error when grabbing exif data")
    return image
