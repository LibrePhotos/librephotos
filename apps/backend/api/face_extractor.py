import numpy as np
import PIL

from api.face_recognition import get_face_locations
from api.metadata.reader import get_metadata
from api.metadata.tags import Tags
from api.util import is_number, logger


ORIENTATION_TRANSFORMS = {
    "Rotate 90 CW": lambda x, y, w, h: (1 - y, x, h, w),
    "Mirror horizontal": lambda x, y, w, h: (1 - x, y, w, h),
    "Rotate 180": lambda x, y, w, h: (1 - x, 1 - y, w, h),
    "Mirror vertical": lambda x, y, w, h: (x, 1 - y, w, h),
    "Mirror horizontal and rotate 270 CW": lambda x, y, w, h: (1 - y, x, h, w),
    "Mirror horizontal and rotate 90 CW": lambda x, y, w, h: (y, 1 - x, h, w),
    "Rotate 270 CW": lambda x, y, w, h: (y, 1 - x, h, w),
}


def has_normalized_area(area, applied_to_dimensions):
    return (area and area.get("Unit") == "normalized") or (
        applied_to_dimensions and applied_to_dimensions.get("Unit") == "pixel"
    )


def to_face_box(area, orientation, image_width, image_height):
    values = [area.get(key) for key in ("X", "Y", "W", "H")]
    if not all(is_number(value) for value in values):
        return None

    x, y, w, h = (float(value) for value in values)
    transform = ORIENTATION_TRANSFORMS.get(orientation)
    if transform:
        x, y, w, h = transform(x, y, w, h)

    half_width = (w * image_width) / 2
    half_height = (h * image_height) / 2
    return (
        int((y * image_height) - half_height),
        int((x * image_width) + half_width),
        int((y * image_height) + half_height),
        int((x * image_width) - half_width),
    )


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

        area = region.get("Area")
        big_thumbnail_image = np.array(PIL.Image.open(big_thumbnail_image_path))
        if not has_normalized_area(area, region.get("AppliedToDimensions")):
            continue

        box = to_face_box(
            area,
            orientation,
            big_thumbnail_image.shape[1],
            big_thumbnail_image.shape[0],
        )
        if box is None:
            logger.info(
                f"Broken face area exif data! No numerical positional data. region_info: {region_info}"
            )
            continue

        face_locations.append((*box, region.get("Name")))
    return face_locations


def extract_from_face_service(image_path, big_thumbnail_path):
    try:
        face_locations = get_face_locations(big_thumbnail_path)
    except Exception:
        logger.exception(f"Can't extract face information on photo: {image_path}")
        face_locations = []

    for i, face_location in enumerate(face_locations):
        face_locations[i] = (*face_location, None)
    return face_locations


def extract(image_path, big_thumbnail_path, owner):
    exif = extract_from_exif(image_path, big_thumbnail_path)
    if not exif:
        return extract_from_face_service(image_path, big_thumbnail_path)
    return exif
