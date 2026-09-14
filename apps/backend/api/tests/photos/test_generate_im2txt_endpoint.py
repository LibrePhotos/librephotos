from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.ml_models import ML_MODELS, MlTypes
from api.tests.utils import create_test_photo, create_test_user


def _create_captioner_files(model_root: Path):
    for model in ML_MODELS:
        if model["type"] != MlTypes.CAPTIONING:
            continue
        for target in [model["target-dir"]] + [
            f["target"] for f in model["additional_files"]
        ]:
            path = model_root / "data_models" / target
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b"model")


class PhotoCaptionsTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user1 = create_test_user()
        self.user2 = create_test_user()
        self.client.force_authenticate(user=self.user1)
        # The endpoint checks for the captioner's files before asking the
        # sidecar; the happy-path tests need them to exist.
        self._media = TemporaryDirectory()
        _create_captioner_files(Path(self._media.name))
        self._settings = override_settings(MEDIA_ROOT=self._media.name)
        self._settings.enable()

    def tearDown(self):
        self._settings.disable()
        self._media.cleanup()

    @patch(
        "api.models.photo_caption.PhotoCaption.generate_captions_im2txt", autospec=True
    )
    def test_generate_captions_for_my_photo(self, generate_caption_mock):
        generate_caption_mock.return_value = True
        photo = create_test_photo(owner=self.user1)

        payload = {"image_hash": photo.image_hash}
        headers = {"Content-Type": "application/json"}
        response = self.client.post(
            "/api/photosedit/generateim2txt/",
            format="json",
            data=payload,
            headers=headers,
        )
        data = response.json()

        self.assertTrue(data["status"])

    @patch(
        "api.models.photo_caption.PhotoCaption.generate_captions_im2txt", autospec=True
    )
    def test_fail_to_generate_captions_for_my_photo(self, generate_caption_mock):
        generate_caption_mock.return_value = False
        photo = create_test_photo(owner=self.user1)

        payload = {"image_hash": photo.image_hash}
        headers = {"Content-Type": "application/json"}
        response = self.client.post(
            "/api/photosedit/generateim2txt/",
            format="json",
            data=payload,
            headers=headers,
        )
        data = response.json()

        self.assertFalse(data["status"])

    @patch("api.views.photos.start_model_download", autospec=True)
    @patch(
        "api.models.photo_caption.PhotoCaption.generate_captions_im2txt", autospec=True
    )
    def test_missing_model_starts_the_download_and_does_not_caption(
        self, generate_caption_mock, start_download_mock
    ):
        """A caption asked for before the model download ran must not hit
        the sidecar (it would fail inside ONNX Runtime); it starts the
        download and tells the client why there is no caption yet."""
        photo = create_test_photo(owner=self.user1)
        with (
            TemporaryDirectory() as empty_media,
            override_settings(MEDIA_ROOT=empty_media),
        ):
            response = self.client.post(
                "/api/photosedit/generateim2txt/",
                format="json",
                data={"image_hash": photo.image_hash},
            )

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertFalse(data["status"])
        self.assertEqual(data["reason"], "model_downloading")
        self.assertIn("downloaded", data["message"])
        start_download_mock.assert_called_once_with(self.user1)
        generate_caption_mock.assert_not_called()

    def test_generate_captions_for_my_photo_of_another_user(self):
        photo = create_test_photo(owner=self.user2)

        payload = {"image_hash": photo.image_hash}
        headers = {"Content-Type": "application/json"}
        response = self.client.post(
            "/api/photosedit/generateim2txt/",
            format="json",
            data=payload,
            headers=headers,
        )
        data = response.json()

        # Returns 404 to avoid leaking existence of other users' photos
        self.assertEqual(404, response.status_code)
        self.assertFalse(data["status"])
        self.assertEqual("photo not found", data["message"])
