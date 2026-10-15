"""The photo detail carries the exposure, altitude and video fields the info panel shows (#2276).

Exposure compensation, flash, metering mode and white balance are camera
information like the aperture the detail already sends. The GPS altitude is
location-derived: only the photo's owner gets it, as with ``ocr``, because the
same endpoint answers share recipients and anonymous visitors of a public photo.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models.photo_metadata import PhotoMetadata
from api.tests.utils import create_test_photo, create_test_user


class PhotoDetailExposureFieldsTest(TestCase):
    def setUp(self) -> None:
        self.owner = create_test_user()
        self.photo = create_test_photo(owner=self.owner, camera="X-T5", fstop=5.6)
        PhotoMetadata.objects.filter(photo=self.photo).update(
            exposure_compensation=-0.7,
            flash_fired=False,
            metering_mode="Multi-segment",
            white_balance="Auto",
            gps_altitude=31.0,
        )

    def detail(self, client: APIClient) -> dict:
        response = client.get(f"/api/photos/{self.photo.image_hash}/")
        self.assertEqual(response.status_code, 200)
        return response.json()

    def owner_client(self) -> APIClient:
        client = APIClient()
        client.force_authenticate(user=self.owner)
        return client

    def test_the_owner_gets_the_exposure_and_the_altitude(self) -> None:
        detail = self.detail(self.owner_client())

        self.assertEqual(
            (-0.7, False, "Multi-segment", "Auto", 31.0),
            (
                detail["exposure_compensation"],
                detail["flash_fired"],
                detail["metering_mode"],
                detail["white_balance"],
                detail["gps_altitude"],
            ),
        )

    def test_a_share_recipient_gets_the_exposure_but_no_altitude(self) -> None:
        viewer = create_test_user()
        self.photo.shared_to.add(viewer)
        client = APIClient()
        client.force_authenticate(user=viewer)

        detail = self.detail(client)

        self.assertEqual(detail["metering_mode"], "Multi-segment")
        self.assertIsNone(detail["gps_altitude"])

    def test_an_anonymous_visitor_of_a_public_photo_gets_no_altitude(self) -> None:
        self.photo.public = True
        self.photo.save()

        detail = self.detail(APIClient())

        self.assertIsNone(detail["gps_altitude"])

    def test_a_photo_without_metadata_has_none_of_them(self) -> None:
        PhotoMetadata.objects.filter(photo=self.photo).delete()

        detail = self.detail(self.owner_client())

        self.assertEqual(
            [None] * 5,
            [
                detail[key]
                for key in (
                    "exposure_compensation",
                    "flash_fired",
                    "metering_mode",
                    "white_balance",
                    "gps_altitude",
                )
            ],
        )

    def test_a_video_has_its_duration_and_codec(self) -> None:
        video = create_test_photo(
            owner=self.owner, video=True, video_length="42.042", video_codec="h264"
        )
        response = self.owner_client().get(f"/api/photos/{video.image_hash}/")

        self.assertEqual(
            ("42.042", "h264"),
            (response.json()["video_length"], response.json()["video_codec"]),
        )

    def test_the_video_fields_cannot_be_written(self) -> None:
        response = self.owner_client().patch(
            f"/api/photos/{self.photo.image_hash}/",
            {"video_codec": "evil", "video_length": "1"},
            format="json",
        )

        self.photo.refresh_from_db()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            (None, None), (self.photo.video_codec, self.photo.video_length)
        )
