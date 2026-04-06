import numpy as np
import PIL

from api.face_recognition import get_face_locations
from api.metadata.reader import get_metadata
from api.metadata.tags import Tags
from api.util import is_number, logger


def extract_from_exif(image_path, big_thumbnail_image_path):
    (region_info, orientation) = get_metadata(
        image_path,
        tags=[Tags.REGION_INFO, Tags.ORIENTATION],
        try_sidecar=True,
        struct=True,
    )
    if not region_info:
        return
    logger.debug(f"Extracted region_info for {image_path}")
    logger.debug(f"region_info: {region_info}")
    face_locations = []
    for region in region_info["RegionList"]:
        if region.get("Type") != "Face":
            continue
        person_name = region.get("Name")

        area = region.get("Area")
        applied_to_dimensions = region.get("AppliedToDimensions")
        big_thumbnail_image = np.array(PIL.Image.open(big_thumbnail_image_path))
        if (area and area.get("Unit") == "normalized") or (
            applied_to_dimensions and applied_to_dimensions.get("Unit") == "pixel"
        ):
            image_width = big_thumbnail_image.shape[1]
            image_height = big_thumbnail_image.shape[0]
            if (
                not is_number(area.get("X"))
                or not is_number(area.get("Y"))
                or not is_number(area.get("W"))
                or not is_number(area.get("H"))
            ):
                logger.info(
                    f"Broken face area exif data! No numerical positional data. region_info: {region_info}"
                )
                continue

            correct_w = float(area.get("W"))
            correct_h = float(area.get("H"))
            correct_x = float(area.get("X"))
            correct_y = float(area.get("Y"))
            if orientation == "Rotate 90 CW":
                temp_x = correct_x
                correct_x = 1 - correct_y
                correct_y = temp_x
                correct_w, correct_h = correct_h, correct_w
            elif orientation == "Mirror horizontal":
                correct_x = 1 - correct_x
            elif orientation == "Rotate 180":
                correct_x = 1 - correct_x
                correct_y = 1 - correct_y
            elif orientation == "Mirror vertical":
                correct_y = 1 - correct_y
            elif orientation == "Mirror horizontal and rotate 270 CW":
                temp_x = correct_x
                correct_x = 1 - correct_y
                correct_y = temp_x
                correct_w, correct_h = correct_h, correct_w
            elif orientation == "Mirror horizontal and rotate 90 CW":
                temp_x = correct_x
                correct_x = correct_y
                correct_y = 1 - temp_x
                correct_w, correct_h = correct_h, correct_w
            elif orientation == "Rotate 270 CW":
                temp_x = correct_x
                correct_x = correct_y
                correct_y = 1 - temp_x
                correct_w, correct_h = correct_h, correct_w

            # Calculate the half-width and half-height of the box
            half_width = (correct_w * image_width) / 2
            half_height = (correct_h * image_height) / 2

            # Calculate the top, right, bottom, and left coordinates
            top = int((correct_y * image_height) - half_height)
            right = int((correct_x * image_width) + half_width)
            bottom = int((correct_y * image_height) + half_height)
            left = int((correct_x * image_width) - half_width)

            face_locations.append((top, right, bottom, left, person_name))
    return face_locations


def extract_from_face_service(image_path, big_thumbnail_path):
    try:
        face_locations = get_face_locations(big_thumbnail_path)
    except Exception as e:
        logger.info(f"Can't extract face information on photo: {image_path}")
        logger.info(e)
        face_locations = []

    for i, face_location in enumerate(face_locations):
        face_locations[i] = (*face_location, None)
    return face_locations


def extract(image_path, big_thumbnail_path, owner):
    exif = extract_from_exif(image_path, big_thumbnail_path)
    if not exif:
        return extract_from_face_service(image_path, big_thumbnail_path)
    return exif
