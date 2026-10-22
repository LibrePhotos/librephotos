"""The scan finds photo spheres in real files, through real ExifTool (#483).

The tag names are checked against ExifTool here: a misspelt one reads nothing
and would pass every test that mocks the metadata read.
"""

import os

import PIL.Image

from api.metadata.photo_reader import extract_exif_data
from api.metadata.projection import EQUIRECTANGULAR, UNTAGGED_SPHERE_MIN_WIDTH
from api.models.photo import Photo
from api.tests.metadata.exiftool_harness import RealExifToolTestCase
from api.tests.utils import create_test_user

GPANO_SPHERE = (
    "-XMP-GPano:ProjectionType=equirectangular",
    "-XMP-GPano:UsePanoramaViewer=True",
)


class PhotoSphereScanTest(RealExifToolTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.user = create_test_user()

    def scan(self, path: str) -> Photo:
        photo = self.photo_for(path, self.user)
        extract_exif_data(photo)
        return Photo.objects.get(pk=photo.pk)

    def make_wide_image(self, width: int, height: int, name: str) -> str:
        path = os.path.join(self.directory, name + ".jpg")
        PIL.Image.new("RGB", (width, height), (40, 120, 200)).save(path)
        return path

    def test_gpano_equirectangular_is_a_sphere(self) -> None:
        image = self.make_image(name="sphere")
        self.tag(image, *GPANO_SPHERE)

        self.assertEqual(EQUIRECTANGULAR, self.scan(image).projection_type)

    def test_an_untagged_photo_is_flat(self) -> None:
        self.assertIsNone(self.scan(self.make_image(name="flat")).projection_type)

    def test_use_panorama_viewer_false_keeps_it_flat(self) -> None:
        image = self.make_image(name="no_viewer")
        self.tag(
            image,
            "-XMP-GPano:ProjectionType=equirectangular",
            "-XMP-GPano:UsePanoramaViewer=False",
        )

        self.assertIsNone(self.scan(image).projection_type)

    def test_a_cylindrical_panorama_is_flat(self) -> None:
        image = self.make_image(name="cylinder")
        self.tag(image, "-XMP-GPano:ProjectionType=cylindrical")

        self.assertIsNone(self.scan(image).projection_type)

    def test_gpano_in_a_sidecar_counts(self) -> None:
        image = self.make_image(name="sidecar")
        sidecar = self.sidecar_of(image)
        self.tag(sidecar, *GPANO_SPHERE)

        self.assertEqual(EQUIRECTANGULAR, self.scan(image).projection_type)

    def test_a_large_untagged_two_to_one_image_is_a_sphere(self) -> None:
        width = UNTAGGED_SPHERE_MIN_WIDTH
        image = self.make_wide_image(width, width // 2, "stitched")

        self.assertEqual(EQUIRECTANGULAR, self.scan(image).projection_type)

    def test_a_rescan_clears_a_projection_the_file_no_longer_has(self) -> None:
        image = self.make_image(name="was_sphere")
        self.tag(image, *GPANO_SPHERE)
        photo = self.scan(image)
        self.tag(image, "-XMP-GPano:all=")

        extract_exif_data(photo)

        photo.refresh_from_db()
        self.assertIsNone(photo.projection_type)
