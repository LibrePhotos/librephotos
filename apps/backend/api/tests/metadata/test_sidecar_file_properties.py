"""A sidecar never answers for the file itself (#2670).

ExifTool reports ``File:FileSize`` (and the other ``File:`` tags) for every
file it reads, an XMP sidecar included, and a RAW editor's sidecar can hold
the pixel size of the RAW. Sidecars win over the media file, so a photo with
a sidecar was stored with the sidecar's size.
"""

import os

from django.test import SimpleTestCase

from api.metadata.photo_reader import extract_exif_data
from api.metadata.tags import Tags, describes_the_file
from api.models.photo import Photo
from api.tests.metadata.exiftool_harness import (
    HEIGHT,
    WIDTH,
    RealExifToolTestCase,
)
from api.tests.utils import create_test_user


class DescribesTheFileTest(SimpleTestCase):
    def test_file_and_system_tags_describe_the_file(self) -> None:
        for tag in (
            Tags.FILE_SIZE,
            Tags.BITS_PER_SAMPLE,
            "File:FileType",
            "file:FileSize",
            "System:FileModifyDate",
        ):
            with self.subTest(tag=tag):
                self.assertTrue(describes_the_file(tag))

    def test_the_pixel_dimensions_describe_the_file(self) -> None:
        self.assertTrue(describes_the_file(Tags.IMAGE_WIDTH))
        self.assertTrue(describes_the_file(Tags.IMAGE_HEIGHT))

    def test_photo_properties_do_not(self) -> None:
        for tag in (
            Tags.RATING,
            Tags.DESCRIPTION,
            Tags.CAMERA,
            Tags.LATITUDE,
            "XMP:FileSize",
            "FileSize",
        ):
            with self.subTest(tag=tag):
                self.assertFalse(describes_the_file(tag))


class SidecarFilePropertiesTest(RealExifToolTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.user = create_test_user()
        self.image = self.make_image(name="IMG_2670")
        self.tag(self.image, "-EXIF:Model=Photo Cam")
        # Lightroom's name, the sidecar read first.
        self.sidecar = os.path.join(self.directory, "IMG_2670.xmp")
        # Writing to a sidecar that does not exist yet creates it.
        self.tag(
            self.sidecar,
            "-XMP-tiff:ImageWidth=6000",
            "-XMP-tiff:ImageHeight=4000",
            "-XMP:Rating=4",
            "-XMP-dc:Title=Sidecar title",
            "-XMP-tiff:Model=Sidecar Cam",
        )

    def test_size_and_dimensions_are_the_media_files(self) -> None:
        self.assertNotEqual(os.path.getsize(self.image), os.path.getsize(self.sidecar))
        photo = self.photo_for(self.image, self.user)

        metadata = extract_exif_data(photo)

        assert metadata is not None
        photo = Photo.objects.get(pk=photo.pk)
        self.assertEqual(os.path.getsize(self.image), photo.size)
        self.assertEqual((WIDTH, HEIGHT), (metadata.width, metadata.height))
        self.assertEqual(8, metadata.bit_depth)

    def test_what_only_the_sidecar_says_still_wins(self) -> None:
        photo = self.photo_for(self.image, self.user)

        metadata = extract_exif_data(photo)

        assert metadata is not None
        photo = Photo.objects.get(pk=photo.pk)
        self.assertEqual(4, photo.rating)
        self.assertEqual("Sidecar title", metadata.title)
        self.assertEqual("Sidecar Cam", metadata.camera_model)
