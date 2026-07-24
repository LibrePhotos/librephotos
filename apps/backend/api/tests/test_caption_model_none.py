"""Regression tests for the "no model selected" guards in PhotoCaption.

The constance choices for ``CAPTIONING_MODEL`` and ``LLM_MODEL`` (and the
frontend Select options) store the lowercase string ``"none"``, while the
shipped default for ``LLM_MODEL`` is the capitalised ``"None"``. Both spellings
must disable captioning / LLM rewriting.
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

    @override_config(CAPTIONING_MODEL="im2txt", LLM_MODEL="none")
    @patch("api.models.photo_caption.generate_prompt")
    @patch("api.models.photo_caption.generate_caption")
    def test_lowercase_none_llm_model_skips_im2txt_rewrite(
        self, mock_generate_caption, mock_generate_prompt
    ):
        """With no LLM selected the raw im2txt caption must be kept as-is."""
        mock_generate_caption.return_value = "a photo of a cat"
        mock_generate_prompt.return_value = None

        result = self.caption.generate_captions_im2txt(commit=False)

        self.assertTrue(result)
        mock_generate_prompt.assert_not_called()
        self.assertEqual(self.caption.captions_json["im2txt"], "a photo of a cat")

    @override_config(CAPTIONING_MODEL="im2txt", LLM_MODEL="None")
    @patch("api.models.photo_caption.generate_prompt")
    @patch("api.models.photo_caption.generate_caption")
    def test_capitalized_none_llm_model_skips_im2txt_rewrite(
        self, mock_generate_caption, mock_generate_prompt
    ):
        """The shipped capitalised default must keep skipping the rewrite."""
        mock_generate_caption.return_value = "a photo of a cat"
        mock_generate_prompt.return_value = None

        result = self.caption.generate_captions_im2txt(commit=False)

        self.assertTrue(result)
        mock_generate_prompt.assert_not_called()
        self.assertEqual(self.caption.captions_json["im2txt"], "a photo of a cat")

    @override_config(
        CAPTIONING_MODEL="im2txt", LLM_MODEL="mistral-7b-instruct-v0.2.Q5_K_M"
    )
    @patch("api.models.photo_caption.generate_prompt")
    @patch("api.models.photo_caption.generate_caption")
    def test_selected_llm_model_still_rewrites_im2txt_caption(
        self, mock_generate_caption, mock_generate_prompt
    ):
        """Positive control: a real LLM selection must still run the rewrite."""
        mock_generate_caption.return_value = "a photo of a cat"
        mock_generate_prompt.return_value = "Anna's cat in Berlin"

        result = self.caption.generate_captions_im2txt(commit=False)

        self.assertTrue(result)
        mock_generate_prompt.assert_called_once()
        self.assertEqual(self.caption.captions_json["im2txt"], "Anna's cat in Berlin")

    @override_config(CAPTIONING_MODEL="moondream", LLM_MODEL="none")
    @patch("api.models.photo_caption.generate_prompt")
    def test_lowercase_none_llm_model_skips_moondream_prompt_enhancement(
        self, mock_generate_prompt
    ):
        """Moondream keeps its plain prompt when no LLM model is selected."""
        mock_generate_prompt.return_value = "a photo of a cat"

        result = self.caption.generate_captions_im2txt(commit=False)

        self.assertTrue(result)
        self.assertEqual(
            mock_generate_prompt.call_args.kwargs["prompt"],
            "Describe this image in a short, natural image caption.",
        )
