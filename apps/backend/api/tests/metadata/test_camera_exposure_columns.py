"""The camera and exposure columns of PhotoMetadata come from the file (#2265).

Make, lens make, serial number, exposure compensation, flash, metering mode,
white balance, colour space, bit depth, shutter speed in seconds, GPS altitude,
subject distance and digital zoom were columns (or API fields) that no scan
ever filled. These run the scan's metadata step against real ExifTool, which
the exif service runs with ``-G -n``: enums arrive as their EXIF codes.
"""

import os

from django.test import SimpleTestCase
from rest_framework.test import APIClient

from api.metadata.photo_reader import extract_exif_data
from api.models.photo_metadata import PhotoMetadata
from api.serializers.photo_metadata import PhotoMetadataSummarySerializer
from api.tests.metadata.exiftool_harness import RealExifToolTestCase
from api.tests.utils import create_test_user

CAMERA_TAGS = (
    "-EXIF:Make=Fujifilm",
    "-EXIF:Model=X-T5",
    "-EXIF:LensMake=Fujifilm",
    "-EXIF:LensModel=XF23mmF2 R WR",
    "-EXIF:SerialNumber=1234",
    "-EXIF:ExposureCompensation=-0.7",
    "-EXIF:Flash#=16",
    "-EXIF:MeteringMode#=5",
    "-EXIF:WhiteBalance#=0",
    "-EXIF:ColorSpace#=1",
    "-EXIF:GPSAltitude=34.5",
    "-EXIF:GPSAltitudeRef#=0",
    "-EXIF:ExposureTime=0.004",
    "-EXIF:SubjectDistance=3.5",
    "-EXIF:DigitalZoomRatio=1.5",
)


class CameraExposureColumnsTest(RealExifToolTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.user = create_test_user()

    def scan(self, *tags: str, name: str = "photo") -> PhotoMetadata:
        image = self.make_image(name=name)
        if tags:
            self.tag(image, *tags)
        photo = self.photo_for(image, self.user)
        metadata = extract_exif_data(photo)
        assert metadata is not None
        return PhotoMetadata.objects.get(pk=metadata.pk)

    def test_every_camera_and_exposure_column_is_filled(self) -> None:
        metadata = self.scan(*CAMERA_TAGS)

        self.assertEqual(
            {
                "camera_make": "Fujifilm",
                "camera_model": "X-T5",
                "lens_make": "Fujifilm",
                "lens_model": "XF23mmF2 R WR",
                "serial_number": "1234",
                "exposure_compensation": -0.7,
                "flash_fired": False,
                "metering_mode": "Multi-segment",
                "white_balance": "Auto",
                "color_space": "sRGB",
                "bit_depth": 8,
                "gps_altitude": 34.5,
                "shutter_speed_seconds": 0.004,
                "subject_distance": 3.5,
                "digital_zoom_ratio": 1.5,
            },
            {
                field: getattr(metadata, field)
                for field in (
                    "camera_make",
                    "camera_model",
                    "lens_make",
                    "lens_model",
                    "serial_number",
                    "exposure_compensation",
                    "flash_fired",
                    "metering_mode",
                    "white_balance",
                    "color_space",
                    "bit_depth",
                    "gps_altitude",
                    "shutter_speed_seconds",
                    "subject_distance",
                    "digital_zoom_ratio",
                )
            },
        )
        self.assertEqual("Fujifilm X-T5", metadata.camera_display)

    def test_a_fired_flash_below_sea_level(self) -> None:
        metadata = self.scan(
            "-EXIF:Flash#=1", "-EXIF:GPSAltitude=12", "-EXIF:GPSAltitudeRef#=1"
        )

        self.assertIs(True, metadata.flash_fired)
        self.assertEqual(-12, metadata.gps_altitude)

    def test_zero_compensation_and_altitude_are_values(self) -> None:
        metadata = self.scan(
            "-EXIF:ExposureCompensation=0",
            "-EXIF:GPSAltitude=0",
            "-EXIF:GPSAltitudeRef#=0",
        )

        self.assertEqual(
            (0, 0), (metadata.exposure_compensation, metadata.gps_altitude)
        )

    def test_unknown_codes_are_kept_as_their_number(self) -> None:
        metadata = self.scan(
            "-EXIF:MeteringMode#=42",
            "-EXIF:WhiteBalance#=7",
            "-EXIF:ColorSpace#=65535",
        )

        self.assertEqual(
            ("42", "7", "Uncalibrated"),
            (metadata.metering_mode, metadata.white_balance, metadata.color_space),
        )

    def test_unknown_subject_distance_and_unused_zoom_stay_empty(self) -> None:
        # EXIF says 0 for "distance unknown" and "digital zoom not used".
        metadata = self.scan("-EXIF:SubjectDistance=0", "-EXIF:DigitalZoomRatio=0")

        self.assertEqual(
            (None, None), (metadata.subject_distance, metadata.digital_zoom_ratio)
        )

    def test_a_file_without_the_tags_leaves_the_columns_empty(self) -> None:
        metadata = self.scan()

        self.assertEqual(
            {
                field: None
                for field in (
                    "camera_make",
                    "lens_make",
                    "serial_number",
                    "exposure_compensation",
                    "flash_fired",
                    "metering_mode",
                    "white_balance",
                    "color_space",
                    "gps_altitude",
                    "shutter_speed_seconds",
                    "subject_distance",
                    "digital_zoom_ratio",
                )
            },
            {
                field: getattr(metadata, field)
                for field in (
                    "camera_make",
                    "lens_make",
                    "serial_number",
                    "exposure_compensation",
                    "flash_fired",
                    "metering_mode",
                    "white_balance",
                    "color_space",
                    "gps_altitude",
                    "shutter_speed_seconds",
                    "subject_distance",
                    "digital_zoom_ratio",
                )
            },
        )

    def test_a_sidecar_names_the_make_and_exposure_settings(self) -> None:
        image = self.make_image(name="IMG_2265")
        self.tag(
            os.path.join(self.directory, "IMG_2265.jpg.xmp"),
            "-XMP-tiff:Make=Sidecar Make",
            "-XMP-exifEX:LensMake=Sidecar Optics",
            "-XMP-exif:ExposureCompensation=1.3",
            "-XMP-exif:MeteringMode#=3",
            "-XMP-exif:WhiteBalance#=1",
        )
        photo = self.photo_for(image, self.user)

        metadata = extract_exif_data(photo)

        assert metadata is not None
        self.assertEqual(
            ("Sidecar Make", "Sidecar Optics", 1.3, "Spot", "Manual"),
            (
                metadata.camera_make,
                metadata.lens_make,
                metadata.exposure_compensation,
                metadata.metering_mode,
                metadata.white_balance,
            ),
        )

    def test_photo_detail_carries_subject_distance_and_zoom(self) -> None:
        image = self.make_image(name="detail")
        self.tag(image, *CAMERA_TAGS)
        photo = self.photo_for(image, self.user)
        extract_exif_data(photo)
        client = APIClient()
        client.force_authenticate(user=self.user)

        detail = client.get(f"/api/photos/{photo.image_hash}/").json()

        self.assertEqual(
            (3.5, 1.5, "Fujifilm X-T5", "Fujifilm XF23mmF2 R WR"),
            (
                detail["subjectDistance"],
                detail["digitalZoomRatio"],
                detail["camera"],
                detail["lens"],
            ),
        )

    def test_the_photo_summary_leaves_the_serial_number_out(self) -> None:
        metadata = self.scan(*CAMERA_TAGS)

        summary = PhotoMetadataSummarySerializer(metadata).data

        self.assertNotIn("serial_number", summary)
        self.assertNotIn("1234", [str(value) for value in summary.values()])


class CameraDisplayTest(SimpleTestCase):
    def display(self, make: str | None, model: str | None) -> str | None:
        return PhotoMetadata(camera_make=make, camera_model=model).camera_display

    def test_make_and_model(self) -> None:
        self.assertEqual("Fujifilm X-T5", self.display("Fujifilm", "X-T5"))

    def test_a_model_that_already_names_the_make(self) -> None:
        self.assertEqual("Canon EOS #2265", self.display("Canon", "Canon EOS #2265"))

    def test_a_model_that_starts_with_the_first_word_of_the_make(self) -> None:
        self.assertEqual("NIKON D850", self.display("NIKON CORPORATION", "NIKON D850"))
        self.assertEqual("NIKON D850", self.display("Nikon Corporation", "NIKON D850"))

    def test_a_model_that_only_starts_with_the_same_letters(self) -> None:
        self.assertEqual("Leica Leicaflex", self.display("Leica", "Leicaflex"))

    def test_lens_make_is_not_repeated_either(self) -> None:
        metadata = PhotoMetadata(lens_make="SIGMA", lens_model="Sigma 35mm F1.4 DG")
        self.assertEqual("Sigma 35mm F1.4 DG", metadata.lens_display)
