"""Face regions against the thumbnail, for every way a file can be turned.

An MWG-RS face region is relative to the image as stored, before the
orientation a viewer applies to show it. LibrePhotos' faces live in the big
thumbnail, which is the file as shown with the user's rotation
(``local_orientation``) on top. Reading a region (``extract_from_exif``) and
writing one (``get_face_region_tags``) convert between the two.

A JPEG is shown under its EXIF Orientation. A HEIC or AVIF is shown under
its HEIF ``irot``/``imir`` properties: libheif applies them and ignores the
EXIF tag, which can disagree with them (LibrePhotos before #2297 wrote
rotations into the EXIF of HEIC originals, and so can any tool, #2615). These tests draw the
region's rectangle into the stored pixels, render that mask the way the
thumbnail renders the file, and compare it with the face box the scan reads
and with the region the face write puts on disk.
"""

from __future__ import annotations

import os
import unittest
from typing import TYPE_CHECKING

import numpy as np
import PIL.Image
from django.test import SimpleTestCase

from api.faces.extractor import extract_from_exif
from api.metadata.orientation import heif_orientation, shown_orientation
from api.metadata.photo_writer import write_photo_metadata
from api.metadata.tags import Tags
from api.models.person import Person
from api.models.photo import Photo
from api.models.user import User
from api.tests.metadata.exiftool_harness import (
    HEIGHT,
    QUADRANTS,
    STORED_LAYOUT,
    WIDTH,
    RealExifToolTestCase,
    autorotated,
    heic_encoder,
    layout,
    load,
)
from api.tests.utils import create_test_face, create_test_person, create_test_user
from api.thumbnails.render import _apply_local_orientation

if TYPE_CHECKING:
    import pyvips

SIDECAR = User.SaveMetadata.SIDECAR_FILE
EXIF_ORIENTATION = 0x0112

# A face region in the stored image (normalized centre, width, height):
# off-centre and wider than tall, so every rotation and flip moves it.
REGION = (0.3, 0.2, 0.3, 0.15)

# (orientation the decoder applies, EXIF Orientation in the file). For a JPEG
# they are one and the same tag; a HEIC carries the first as irot/imir.
JPEG_CASES = [(o, o) for o in range(1, 9)]
HEIC_CASES = [(o, o) for o in range(1, 9)] + [
    # The EXIF tag disagrees with irot/imir, or is missing.
    (1, 6),
    (1, 8),
    (1, 2),
    (6, 1),
    (6, 3),
    (6, None),
    (8, 6),
    (5, 1),
    (2, 7),
]
AVIF_CASES = [(1, 1), (6, 6), (5, 5), (1, 6), (6, 1), (7, 2)]
# The user's rotations and flips in LibrePhotos.
LOCAL_ORIENTATIONS = (1, 2, 5, 6, 8)


def _stored_image() -> PIL.Image.Image:
    image = PIL.Image.new("RGB", (WIDTH, HEIGHT))
    half_w, half_h = WIDTH // 2, HEIGHT // 2
    for index, colour in enumerate(STORED_LAYOUT):
        left, top = (index % 2) * half_w, (index // 2) * half_h
        image.paste(QUADRANTS[colour], (left, top, left + half_w, top + half_h))
    return image


def _mask(area: tuple[float, float, float, float]) -> pyvips.Image:
    """The stored image's pixels inside ``area`` (an MWG-RS region) white."""
    import pyvips

    x, y, w, h = area
    mask = np.zeros((HEIGHT, WIDTH), dtype=np.uint8)
    mask[
        round((y - h / 2) * HEIGHT) : round((y + h / 2) * HEIGHT),
        round((x - w / 2) * WIDTH) : round((x + w / 2) * WIDTH),
    ] = 255
    return pyvips.Image.new_from_array(mask)


def _box(image: pyvips.Image) -> tuple[int, int, int, int]:
    """(top, right, bottom, left) of the white pixels, as Face stores a box."""
    rows, columns = np.nonzero(image.numpy() > 127)
    return (
        int(rows.min()),
        int(columns.max()) + 1,
        int(rows.max()) + 1,
        int(columns.min()),
    )


def _shown(
    stored: pyvips.Image, decoder_orientation: int, local_orientation: int
) -> pyvips.Image:
    """``stored`` as the big thumbnail shows it."""
    return _apply_local_orientation(
        autorotated(stored, decoder_orientation), local_orientation
    )


class FaceRegionOrientationTest(RealExifToolTestCase):
    def _jpeg(self, name: str, decoder: int, exif: int | None) -> str:
        path = os.path.join(self.directory, name + ".jpg")
        _stored_image().save(path, quality=95)
        if exif is not None:
            self.tag(path, f"-EXIF:Orientation#={exif}")
        return path

    def _heic(self, name: str, decoder: int, exif: int | None) -> str:
        """A HEIC shown under ``decoder`` (pillow-heif writes it as irot/imir
        and as EXIF), its EXIF Orientation then set to ``exif``."""
        if not heic_encoder():
            raise unittest.SkipTest("this pillow-heif build has no HEVC encoder")
        path = os.path.join(self.directory, name + ".heic")
        if decoder == 1:
            _stored_image().save(path)
        else:
            tags = PIL.Image.Exif()
            tags[EXIF_ORIENTATION] = decoder
            _stored_image().save(path, exif=tags.tobytes())
        if exif is None:
            self.tag(path, "-EXIF:Orientation=")
        elif exif != decoder:
            self.tag(path, f"-EXIF:Orientation#={exif}")
        return path

    def _avif(self, name: str, decoder: int, exif: int | None) -> str:
        """An AVIF shown under ``decoder`` (libvips writes it as irot/imir and
        as EXIF), its EXIF Orientation then set to ``exif``."""
        import pyvips

        path = os.path.join(self.directory, name + ".avif")
        image = pyvips.Image.new_from_array(np.asarray(_stored_image())).copy()
        image.set_type(pyvips.GValue.gint_type, "orientation", decoder)
        try:
            image.heifsave(path, compression="av1", lossless=True)
        except pyvips.Error as error:
            raise unittest.SkipTest(f"libvips cannot encode AVIF here: {error}")
        if exif != decoder:
            self.tag(path, f"-EXIF:Orientation#={exif}")
        return path

    def _cases(self):
        for extension, make, cases in (
            (".jpg", self._jpeg, JPEG_CASES),
            (".heic", self._heic, HEIC_CASES),
            (".avif", self._avif, AVIF_CASES),
        ):
            for decoder, exif in cases:
                for local in LOCAL_ORIENTATIONS:
                    name = f"{extension[1:]}-{decoder}-{exif}-{local}"
                    yield name, make, decoder, exif, local

    def _photo(self, path: str, local: int) -> Photo:
        user = create_test_user(
            save_metadata_to_disk=SIDECAR, save_face_tags_to_disk=True
        )
        return self.photo_for(path, user, thumbnails=True, local_orientation=local)

    def _check_thumbnail(self, photo: Photo, decoder: int, local: int) -> None:
        """The fixture renders under ``decoder``: the premise of the test."""
        import pyvips

        stored = pyvips.Image.new_from_array(np.asarray(_stored_image()))
        self.assertEqual(
            layout(_shown(stored, decoder, local)),
            layout(load(photo.thumbnail.thumbnail_big.path)),
            "the fixture does not render as the test assumes",
        )

    def test_a_region_in_the_file_is_read_onto_the_face(self):
        x, y, w, h = REGION
        for name, make, decoder, exif, local in self._cases():
            with self.subTest(file=name):
                path = make(f"read-{name}", decoder, exif)
                self.tag(
                    path,
                    "-XMP-mwg-rs:RegionInfo="
                    f"{{AppliedToDimensions={{W={WIDTH},H={HEIGHT},Unit=pixel}},"
                    f"RegionList=[{{Area={{X={x},Y={y},W={w},H={h},"
                    "Unit=normalized},Name=Alice,Type=Face}]}",
                )
                photo = self._photo(path, local)
                self._check_thumbnail(photo, decoder, local)

                ((*box, person),) = extract_from_exif(
                    path,
                    photo.thumbnail.thumbnail_big.path,
                    local_orientation=photo.local_orientation,
                )

                self.assertEqual("Alice", person)
                expected = _box(_shown(_mask(REGION), decoder, local))
                for read, drawn in zip(box, expected):
                    self.assertAlmostEqual(
                        drawn, read, delta=2, msg=f"read {box}, face at {expected}"
                    )

    def test_a_labelled_face_is_written_where_it_is_in_the_file(self):
        for name, make, decoder, exif, local in self._cases():
            with self.subTest(file=name):
                path = make(f"write-{name}", decoder, exif)
                photo = self._photo(path, local)
                self._check_thumbnail(photo, decoder, local)
                # The face: REGION of the stored image, as the thumbnail shows it.
                top, right, bottom, left = _box(_shown(_mask(REGION), decoder, local))
                person = create_test_person(
                    name="Alice", kind=Person.KIND_USER, cluster_owner=photo.owner
                )
                create_test_face(
                    photo=photo,
                    person=person,
                    location_top=top,
                    location_right=right,
                    location_bottom=bottom,
                    location_left=left,
                )

                write_photo_metadata(
                    photo, use_sidecar=True, metadata_types=["face_tags"]
                )

                sidecar = self.sidecar_of(path)
                region = self.read_tags(sidecar, Tags.REGION_INFO)[Tags.REGION_INFO]
                area = region["RegionList"][0]["Area"]
                written = tuple(float(area[key]) for key in ("X", "Y", "W", "H"))
                for key, value, expected in zip("XYWH", written, REGION):
                    self.assertAlmostEqual(
                        expected,
                        value,
                        delta=0.03,
                        msg=f"{key}: wrote {written}, the face is at {REGION}",
                    )


class HeifOrientationTest(SimpleTestCase):
    """The scan reads irot/imir as ExifTool prints them (``-struct``), the
    face write as numbers (``-n``): both must give the same orientation."""

    PRINTED_ROTATION = {
        0: "Horizontal (normal)",
        1: "Rotate 270 CW",
        2: "Rotate 180",
        3: "Rotate 90 CW",
    }
    PRINTED_MIRRORING = {None: None, 0: "Vertical", 1: "Horizontal"}

    def test_printed_and_numeric_values_agree(self):
        seen = set()
        for rotation, printed_rotation in self.PRINTED_ROTATION.items():
            for mirroring, printed_mirroring in self.PRINTED_MIRRORING.items():
                with self.subTest(rotation=rotation, mirroring=mirroring):
                    numeric = heif_orientation(rotation, mirroring)
                    self.assertEqual(
                        numeric, heif_orientation(printed_rotation, printed_mirroring)
                    )
                    self.assertEqual(
                        numeric, heif_orientation(str(rotation), mirroring)
                    )
                    seen.add(numeric)
        self.assertEqual(set(range(1, 9)), seen)

    def test_no_properties_is_upright(self):
        self.assertEqual(1, heif_orientation(None, None))

    def test_only_heif_files_ignore_their_exif_orientation(self):
        self.assertEqual(6, shown_orientation("/photos/a.jpg", 6, None, None))
        self.assertEqual(1, shown_orientation("/photos/a.HEIC", 6, None, None))
        self.assertEqual(6, shown_orientation("/photos/a.avif", 1, 3, None))
