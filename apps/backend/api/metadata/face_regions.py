import PIL

from api.metadata.reader import get_metadata
from api.metadata.tags import Tags
from api.models.face import Face
from api.models.person import Person
from api.util import logger


def thumbnail_coords_to_normalized(top, right, bottom, left, thumb_width, thumb_height):
    """Convert Face model pixel coords (in big thumbnail space) to MWG-RS
    normalized center-based coords."""
    center_x = (left + right) / 2.0 / thumb_width
    center_y = (top + bottom) / 2.0 / thumb_height
    w = (right - left) / thumb_width
    h = (bottom - top) / thumb_height
    return center_x, center_y, w, h


def reverse_orientation_transform(x, y, w, h, orientation):
    """Invert the orientation transforms from face_extractor.py lines 54-80.

    The read path applies a forward transform from XMP coords to display coords.
    This function reverses that so we can go from display coords back to XMP coords.
    """
    if orientation == "Rotate 90 CW":
        # Forward: x' = 1 - y, y' = x, swap w/h
        # Reverse: y_orig = 1 - x', x_orig = y'
        new_x = y
        new_y = 1 - x
        w, h = h, w
        return new_x, new_y, w, h
    elif orientation == "Mirror horizontal":
        # Forward: x' = 1 - x
        # Reverse: x = 1 - x'
        return 1 - x, y, w, h
    elif orientation == "Rotate 180":
        # Forward: x' = 1 - x, y' = 1 - y
        # Reverse: same
        return 1 - x, 1 - y, w, h
    elif orientation == "Mirror vertical":
        # Forward: y' = 1 - y
        # Reverse: y = 1 - y'
        return x, 1 - y, w, h
    elif orientation == "Mirror horizontal and rotate 270 CW":
        # Forward: x' = 1 - y, y' = x, swap w/h
        # Same as Rotate 90 CW (the mirror cancels differently)
        new_x = y
        new_y = 1 - x
        w, h = h, w
        return new_x, new_y, w, h
    elif orientation == "Mirror horizontal and rotate 90 CW":
        # Forward: x' = y, y' = 1 - x, swap w/h
        # Reverse: x_orig = 1 - y', y_orig = x'
        new_x = 1 - y
        new_y = x
        w, h = h, w
        return new_x, new_y, w, h
    elif orientation == "Rotate 270 CW":
        # Forward: x' = y, y' = 1 - x, swap w/h
        # Reverse: x_orig = 1 - y', y_orig = x'
        new_x = 1 - y
        new_y = x
        w, h = h, w
        return new_x, new_y, w, h
    # Normal orientation or unknown — no transform
    return x, y, w, h


def _escape_exiftool_value(value):
    """Escape special characters in a string value for exiftool structured data.

    ExifTool uses commas, equals, braces in its structured value syntax,
    so person names containing these characters need escaping.
    """
    # ExifTool expects special chars to be escaped with backslash
    for ch in ("\\", "{", "}", "=", ","):
        value = value.replace(ch, f"\\{ch}")
    return value


def build_face_region_exiftool_args(face_regions, image_width=None, image_height=None):
    """Build exiftool args dict for writing XMP-mwg-rs:RegionInfo and XMP:Subject.

    Args:
        face_regions: list of dicts with keys: name, x, y, w, h
        image_width: original image width in pixels (for AppliedToDimensions)
        image_height: original image height in pixels (for AppliedToDimensions)

    Returns:
        dict of tag -> value suitable for write_metadata()
    """
    region_parts = []
    person_names = []
    for region in face_regions:
        name = _escape_exiftool_value(region["name"])
        x = f"{region['x']:.6f}"
        y = f"{region['y']:.6f}"
        w = f"{region['w']:.6f}"
        h = f"{region['h']:.6f}"
        region_parts.append(
            f"{{Area={{X={x},Y={y},W={w},H={h},Unit=normalized}}"
            f",Name={name},Type=Face}}"
        )
        if region["name"]:
            person_names.append(region["name"])

    region_list = ",".join(region_parts)

    # Include AppliedToDimensions if image dimensions are available
    if image_width and image_height:
        applied_to = f"AppliedToDimensions={{W={image_width},H={image_height},Unit=pixel}},"
    else:
        applied_to = ""

    value = f"{{{applied_to}RegionList=[{region_list}]}}"

    tags = {Tags.REGION_INFO_WRITE: value}

    # Add person names as XMP:Subject keywords for Lightroom compatibility
    if person_names:
        tags[Tags.SUBJECT] = person_names

    return tags


def get_face_region_tags(photo):
    """Build face region exiftool tags dict for a photo.

    Returns a dict of tags suitable for merging into _save_metadata()'s tags_to_write,
    or an empty dict if no faces exist.

    Args:
        photo: Photo model instance

    Returns:
        dict: e.g. {"XMP-mwg-rs:RegionInfo": "{RegionList=[...]}"}  or {}
    """
    faces = Face.objects.filter(
        photo=photo,
        deleted=False,
    ).select_related("person")

    if not faces.exists():
        return {}

    # Get thumbnail dimensions
    try:
        thumb_path = photo.thumbnail.thumbnail_big.path
        thumb_image = PIL.Image.open(thumb_path)
        thumb_width, thumb_height = thumb_image.size
        thumb_image.close()
    except Exception:
        logger.error(
            f"Cannot open thumbnail for photo {photo.image_hash}, skipping face tags"
        )
        return {}

    # Get EXIF orientation and original image dimensions
    (orientation, image_width, image_height) = get_metadata(
        photo.main_file.path,
        tags=[Tags.ORIENTATION, Tags.IMAGE_WIDTH, Tags.IMAGE_HEIGHT],
        try_sidecar=True,
    )

    # Convert each face's coordinates
    face_regions = []
    for face in faces:
        x, y, w, h = thumbnail_coords_to_normalized(
            face.location_top,
            face.location_right,
            face.location_bottom,
            face.location_left,
            thumb_width,
            thumb_height,
        )
        x, y, w, h = reverse_orientation_transform(x, y, w, h, orientation)
        # Only write person name for user-labeled faces
        if face.person and face.person.kind == Person.KIND_USER:
            name = face.person.name
        else:
            name = ""
        face_regions.append(
            {
                "name": name,
                "x": x,
                "y": y,
                "w": w,
                "h": h,
            }
        )

    return build_face_region_exiftool_args(face_regions, image_width, image_height)
