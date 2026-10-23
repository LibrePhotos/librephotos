"""Whether a photo is a photo sphere, from what its file says (#483).

A 360° photo sphere is stored as one equirectangular image: twice as wide as
tall, longitude across, latitude down. Phones (Google Camera, Samsung), 360°
cameras (Ricoh Theta, Insta360, GoPro Max) and stitchers (PTGui) say so in
Google's Photo Sphere XMP, ``GPano:ProjectionType``. The web app opens such a
photo in a panorama viewer when asked.

Pure functions over the values ``api.metadata.photo_reader`` read; the scan
stores the answer as ``Photo.projection_type``.
"""

from __future__ import annotations

from collections.abc import Mapping

#: ``Photo.projection_type`` of a photo sphere, as GPano spells it.
EQUIRECTANGULAR = "equirectangular"

#: The narrowest file taken for a photo sphere without GPano XMP: stitchers
#: like Hugin write none. Narrower 2:1 images are left alone, since phones
#: shoot 18:9 photos (4160 x 2080) that are not spheres.
UNTAGGED_SPHERE_MIN_WIDTH = 6000


def _says_no_viewer(value: object) -> bool:
    """Whether ``GPano:UsePanoramaViewer`` is false.

    The exif service reads with ``-n``, so it is a JSON boolean; a sidecar
    written by hand may still give "False".
    """
    if isinstance(value, bool):
        return not value
    return isinstance(value, str) and value.strip().casefold() == "false"


def _is_whole_sphere_shape(width: object, height: object) -> bool:
    """Whether the stored size is exactly 2:1 and at least the minimum width."""
    if isinstance(width, bool) or isinstance(height, bool):
        return False
    if not isinstance(width, int) or not isinstance(height, int):
        return False
    return width >= UNTAGGED_SPHERE_MIN_WIDTH and width == 2 * height


def projection_type_of(values: Mapping[str, object], is_video: bool) -> str | None:
    """The photo's projection: ``EQUIRECTANGULAR`` for a photo sphere, else None.

    GPano decides when the file has it: ``ProjectionType`` equirectangular,
    unless ``UsePanoramaViewer`` is false. Other projections (cylindrical,
    cubemap) are not shown in the viewer, so they count as flat. A file
    without a projection type is a sphere only when it is exactly twice as
    wide as tall and at least ``UNTAGGED_SPHERE_MIN_WIDTH`` wide. 360° videos
    are not handled (yet), so a video is always flat.
    """
    if is_video or _says_no_viewer(values.get("use_panorama_viewer")):
        return None
    projection = values.get("projection_type")
    if isinstance(projection, str) and projection.strip():
        return (
            EQUIRECTANGULAR
            if projection.strip().casefold() == EQUIRECTANGULAR
            else None
        )
    if _is_whole_sphere_shape(values.get("width"), values.get("height")):
        return EQUIRECTANGULAR
    return None
