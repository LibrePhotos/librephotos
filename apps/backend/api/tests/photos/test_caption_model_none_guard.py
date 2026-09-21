"""Regression tests for the "no model selected" guards in PhotoCaption.

The constance choices for ``CAPTIONING_MODEL`` (and the frontend Select
options) store the lowercase string ``"none"``, while older installs may carry
the capitalised ``"None"``. Both spellings must disable captioning.
"""

from unittest.mock import patch

from constance.test import override_config
from django.test import TestCase, override_settings

from api.models import PhotoCaption
from api.tests.utils import create_test_photo, create_test_user


@override_settings(FEATURE_IMAGE_CAPTIONING=True)
class CaptionModelNoneTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.user.llm_settings = {
            **self.user.llm_settings,
            "enabled": True,
        }
        self.user.save()
        # search_location makes create_test_photo build a PhotoSearch row, which
        # the LLM prompt branch dereferences.
        self.photo = create_test_photo(owner=self.user, search_location="Berlin")
        self.caption = PhotoCaption.objects.create(photo=self.photo)

    @override_config(CAPTIONING_MODEL="none")
    @patch("api.models.photo_caption.generate_caption")
    def test_lowercase_none_captioning_model_disables_captioning(
        self, mock_generate_caption
    ):
        """Selecting "None" in the UI stores "none" and must skip captioning."""
        mock_generate_caption.return_value = "a photo of a cat"

        result = self.caption.generate_captions_im2txt(commit=False)

        self.assertFalse(result)
        mock_generate_caption.assert_not_called()
        self.assertNotIn("im2txt", self.caption.captions_json or {})

    @override_config(CAPTIONING_MODEL="None")
    @patch("api.models.photo_caption.generate_caption")
    def test_capitalized_none_captioning_model_disables_captioning(
        self, mock_generate_caption
    ):
        mock_generate_caption.return_value = "a photo of a cat"

        result = self.caption.generate_captions_im2txt(commit=False)

        self.assertFalse(result)
        mock_generate_caption.assert_not_called()
