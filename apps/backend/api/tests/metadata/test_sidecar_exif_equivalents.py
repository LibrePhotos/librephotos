"""A sidecar's exif:/tiff:/exifEX: properties reach the photo (#2261).

Another app (a geotagger, digiKam, darktable, Lightroom) stores the capture
date, position, camera and lens of a photo it may not rewrite in an XMP
sidecar, under the XMP names of those EXIF properties. ExifTool reports them
as ``XMP:<Name>``, not under the ``EXIF:``/``Composite:`` names LibrePhotos
asks for, so the scan has to ask a sidecar by those names.
"""

import os
from unittest.mock import patch

from api.geocode.photo_location import geolocate_photo
from api.metadata.photo_datetime import extract_date_time
from api.metadata.photo_reader import extract_exif_data
from api.models.photo import Photo
from api.tests.metadata.exiftool_harness import RealExifToolTestCase
from api.tests.utils import create_test_user


class SidecarExifPropertiesTest(RealExifToolTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.user = create_test_user()
        # A JPEG without EXIF date, position or camera of its own.
        self.image = self.make_image(name="IMG_1234")
        self.sidecar = os.path.join(self.directory, "IMG_1234.jpg.xmp")

    def write_sidecar(self, *arguments: str) -> None:
        # Writing to a sidecar that does not exist yet creates it.
        self.tag(self.sidecar, *arguments)

    def test_the_sidecar_date_is_the_capture_date(self) -> None:
        self.write_sidecar("-XMP-exif:DateTimeOriginal=2019:07:01 08:00:00+02:00")
        photo = self.photo_for(self.image, self.user)

        extract_date_time(photo)

        assert photo.exif_timestamp is not None
        self.assertEqual(
            (2019, 7, 1, 8, 0),
            (
                photo.exif_timestamp.year,
                photo.exif_timestamp.month,
                photo.exif_timestamp.day,
                photo.exif_timestamp.hour,
                photo.exif_timestamp.minute,
            ),
        )

    def test_the_sidecar_position_is_stored(self) -> None:
        # Written numerically (-n): south and west are the negative signs.
        self.write_sidecar(
            "-XMP-exif:GPSLatitude=-33.9", "-XMP-exif:GPSLongitude=-118.4"
        )
        photo = self.photo_for(self.image, self.user)

        with patch("api.geocode.photo_location.reverse_geocode", return_value=None):
            geolocate_photo(photo)

        photo = Photo.objects.get(pk=photo.pk)
        self.assertEqual((-33.9, -118.4), (photo.exif_gps_lat, photo.exif_gps_lon))

    def test_the_sidecar_camera_and_exposure_are_stored(self) -> None:
        self.write_sidecar(
            "-XMP-tiff:Model=Sidecar Cam",
            "-XMP-exifEX:LensModel=Sidecar Lens",
            "-XMP-exif:FNumber=8",
            "-XMP-exif:ISO=1600",
        )
        photo = self.photo_for(self.image, self.user)

        metadata = extract_exif_data(photo)

        assert metadata is not None
        self.assertEqual(
            ("Sidecar Cam", "Sidecar Lens", 8, 1600),
            (
                metadata.camera_model,
                metadata.lens_model,
                metadata.aperture,
                metadata.iso,
            ),
        )
