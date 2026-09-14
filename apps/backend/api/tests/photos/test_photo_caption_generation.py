"""Characterization tests for PhotoCaption caption-generation (CRAP unit 22).

Pins the behavior of ``PhotoCaption.generate_captions_im2txt``: the guard
clauses and the prompt the captioning sidecar is given.

These are deliberately behavior-preserving snapshots taken before refactoring.
Where current behavior looks like a bug it is still pinned, and flagged in a
comment.
"""

from unittest.mock import PropertyMock, patch

from constance.test import override_config
from django.test import TestCase, override_settings

from api.models import PhotoCaption
from api.tests.utils import create_test_face, create_test_person, create_test_photo
from api.tests.utils import create_test_user


def _llm_settings(**overrides):
    base = {
        "enabled": False,
        "add_person": False,
        "add_location": False,
        "add_keywords": False,
        "add_camera": False,
        "add_lens": False,
        "add_album": False,
        "sentiment": 0,
        "custom_prompt": "",
        "custom_prompt_enabled": False,
    }
    base.update(overrides)
    return base


@override_settings(FEATURE_IMAGE_CAPTIONING=True)
class Im2txtGuardTest(TestCase):
    """Guard clauses of generate_captions_im2txt (before the try block)."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        self.caption = PhotoCaption.objects.create(photo=self.photo)

    @override_settings(FEATURE_IMAGE_CAPTIONING=False)
    @patch("api.models.photo_caption.generate_caption")
    def test_feature_flag_disabled_returns_false(self, mock_generate_caption):
        self.assertFalse(self.caption.generate_captions_im2txt(commit=False))
        mock_generate_caption.assert_not_called()
        self.assertIsNone(self.caption.captions_json)

    @override_config(CAPTIONING_MODEL="lfm2_vl_450m")
    @patch("api.models.photo_caption.generate_caption")
    def test_empty_thumbnail_big_returns_false(self, mock_generate_caption):
        thumb = self.photo.thumbnail
        thumb.thumbnail_big = ""
        thumb.save()
        self.photo.refresh_from_db()

        caption = PhotoCaption.objects.get(pk=self.caption.pk)
        self.assertFalse(caption.generate_captions_im2txt(commit=False))
        mock_generate_caption.assert_not_called()

    @override_config(CAPTIONING_MODEL="lfm2_vl_450m")
    @patch("api.models.photo_caption.generate_caption")
    def test_unreadable_thumbnail_path_returns_false(self, mock_generate_caption):
        with patch(
            "django.db.models.fields.files.FieldFile.path",
            new_callable=PropertyMock,
            side_effect=ValueError("no path"),
        ):
            self.assertFalse(self.caption.generate_captions_im2txt(commit=False))
        mock_generate_caption.assert_not_called()

    @override_config(CAPTIONING_MODEL="none")
    @patch("api.models.photo_caption.generate_caption")
    def test_captioning_model_none_returns_false_but_initializes_json(
        self, mock_generate_caption
    ):
        # The captions_json = {} initialization happens *before* the "none"
        # check, so the in-memory object is mutated even on the disabled path.
        self.assertFalse(self.caption.generate_captions_im2txt(commit=False))
        mock_generate_caption.assert_not_called()
        self.assertEqual(self.caption.captions_json, {})


@override_settings(FEATURE_IMAGE_CAPTIONING=True)
class Im2txtGenerationTest(TestCase):
    """The sidecar caption path with the LLM rewrite disabled."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        self.caption = PhotoCaption.objects.create(photo=self.photo)

    @override_config(CAPTIONING_MODEL="lfm2_vl_450m")
    @patch("api.models.photo_caption.generate_caption")
    def test_sidecar_happy_path_strips_markers_and_saves(self, mock_generate_caption):
        mock_generate_caption.return_value = "  <start> a photo of a cat <end>  "

        result = self.caption.generate_captions_im2txt(commit=True)

        self.assertTrue(result)
        self.assertEqual(mock_generate_caption.call_count, 1)
        kwargs = mock_generate_caption.call_args.kwargs
        self.assertEqual(set(kwargs), {"image_path", "prompt"})
        self.assertTrue(kwargs["image_path"].endswith(".webp"))
        # Caption context is on by default; with nothing known about the
        # photo (no named face, no place) only the base instruction remains.
        self.assertEqual(kwargs["prompt"], "Write a short, natural image caption.")
        self.assertEqual(self.caption.captions_json["im2txt"], "a photo of a cat")

        self.caption.refresh_from_db()
        self.assertEqual(self.caption.captions_json["im2txt"], "a photo of a cat")

    @override_config(CAPTIONING_MODEL="lfm2_vl_450m")
    @patch("api.models.photo_caption.generate_caption")
    def test_any_selected_model_uses_the_sidecar(self, mock_generate_caption):
        mock_generate_caption.return_value = "a caption"

        self.assertTrue(self.caption.generate_captions_im2txt(commit=False))
        self.assertEqual(self.caption.captions_json["im2txt"], "a caption")

    @override_config(CAPTIONING_MODEL="lfm2_vl_450m")
    @patch("api.models.photo_caption.generate_caption")
    def test_commit_false_does_not_persist_caption(self, mock_generate_caption):
        mock_generate_caption.return_value = "not persisted"

        self.assertTrue(self.caption.generate_captions_im2txt(commit=False))
        self.assertEqual(self.caption.captions_json["im2txt"], "not persisted")

        fresh = PhotoCaption.objects.get(pk=self.caption.pk)
        self.assertIsNone(fresh.captions_json)

    @override_config(CAPTIONING_MODEL="lfm2_vl_450m")
    @patch("api.models.photo_caption.generate_caption")
    def test_existing_caption_keys_are_preserved(self, mock_generate_caption):
        self.caption.captions_json = {"user_caption": "mine", "im2txt": "old"}
        self.caption.save()
        mock_generate_caption.return_value = "new caption"

        self.assertTrue(self.caption.generate_captions_im2txt(commit=True))
        self.caption.refresh_from_db()
        self.assertEqual(self.caption.captions_json["user_caption"], "mine")
        self.assertEqual(self.caption.captions_json["im2txt"], "new caption")

    @override_config(CAPTIONING_MODEL="lfm2_vl_450m")
    @patch("api.models.photo_caption.generate_caption")
    def test_generate_caption_exception_returns_false(self, mock_generate_caption):
        mock_generate_caption.side_effect = RuntimeError("model exploded")

        self.assertFalse(self.caption.generate_captions_im2txt(commit=True))
        fresh = PhotoCaption.objects.get(pk=self.caption.pk)
        self.assertIsNone(fresh.captions_json)

    @override_config(CAPTIONING_MODEL="lfm2_vl_450m")
    @patch("api.models.photo_caption.generate_caption")
    def test_non_string_caption_result_returns_false(self, mock_generate_caption):
        # ``.replace`` on a non-str blows up inside the try -> swallowed.
        mock_generate_caption.return_value = None

        self.assertFalse(self.caption.generate_captions_im2txt(commit=False))

    @override_config(CAPTIONING_MODEL="lfm2_vl_450m")
    @patch("api.models.photo_caption.generate_caption")
    def test_recreate_search_captions_is_invoked(self, mock_generate_caption):
        mock_generate_caption.return_value = "a photo of a cat"

        self.assertTrue(self.caption.generate_captions_im2txt(commit=True))

        from api.models.photo_search import PhotoSearch

        search = PhotoSearch.objects.get(photo=self.photo)
        self.assertIn("a photo of a cat", search.search_captions)


@override_settings(FEATURE_IMAGE_CAPTIONING=True)
class CaptionPromptTest(TestCase):
    """What the captioning sidecar is asked, given the user's caption settings."""

    def setUp(self):
        self.user = create_test_user()
        self.user.llm_settings = _llm_settings(
            enabled=True, add_person=True, add_location=True, add_keywords=True
        )
        self.user.save()
        self.photo = create_test_photo(owner=self.user, search_location="Berlin")
        self.caption = PhotoCaption.objects.create(photo=self.photo)
        create_test_face(photo=self.photo, person=create_test_person(name="Anna"))

    @override_config(CAPTIONING_MODEL="lfm2_vl_450m")
    @patch("api.models.photo_caption.generate_caption")
    def test_full_prompt_carries_person_place_and_keywords(self, mock_caption):
        """Names and places reach the captioner directly."""
        mock_caption.return_value = "Anna in Berlin"

        self.assertTrue(self.caption.generate_captions_im2txt(commit=False))

        prompt = mock_caption.call_args.kwargs["prompt"]
        self.assertTrue(prompt.startswith("Write a short, natural image caption."))
        self.assertIn("The person in the photo is named Anna.", prompt)
        self.assertIn("Use the name 'Anna' directly in the caption", prompt)
        self.assertIn("This photo was taken at Berlin.", prompt)
        self.assertIn("Include relevant tags and keywords.", prompt)
        self.assertEqual(self.caption.captions_json["im2txt"], "Anna in Berlin")

    @override_config(CAPTIONING_MODEL="lfm2_vl_450m")
    @patch("api.models.photo_caption.generate_caption")
    def test_person_omitted_when_add_person_false(self, mock_caption):
        self.user.llm_settings = _llm_settings(enabled=True, add_location=True)
        self.user.save()
        mock_caption.return_value = "caption"

        self.assertTrue(self.caption.generate_captions_im2txt(commit=False))
        prompt = mock_caption.call_args.kwargs["prompt"]
        self.assertNotIn("Anna", prompt)
        self.assertIn("This photo was taken at Berlin.", prompt)
        self.assertNotIn("Include relevant tags", prompt)

    @override_config(CAPTIONING_MODEL="lfm2_vl_450m")
    @patch("api.models.photo_caption.generate_caption")
    def test_place_omitted_when_no_face_and_no_flags(self, mock_caption):
        from api.models import Face

        Face.objects.filter(photo=self.photo).delete()
        self.user.llm_settings = _llm_settings(enabled=True, add_person=True)
        self.user.save()
        mock_caption.return_value = "caption"

        self.assertTrue(self.caption.generate_captions_im2txt(commit=False))
        self.assertEqual(
            mock_caption.call_args.kwargs["prompt"],
            "Write a short, natural image caption.",
        )

    @override_config(CAPTIONING_MODEL="lfm2_vl_450m")
    @patch("api.models.photo_caption.generate_caption")
    def test_plain_prompt_when_caption_settings_disabled(self, mock_caption):
        self.user.llm_settings = _llm_settings(enabled=False, add_person=True)
        self.user.save()
        mock_caption.return_value = "caption"

        self.assertTrue(self.caption.generate_captions_im2txt(commit=False))
        self.assertEqual(
            mock_caption.call_args.kwargs["prompt"],
            "Describe this image in a short, natural image caption.",
        )

    @override_config(CAPTIONING_MODEL="lfm2_vl_450m")
    @patch("api.models.photo_caption.generate_caption")
    def test_missing_search_instance_just_drops_the_place(self, mock_caption):
        """A photo that has not been scanned yet has no PhotoSearch row; the
        caption still happens, without a location."""
        photo = create_test_photo(owner=self.user)
        create_test_face(photo=photo, person=create_test_person(name="Anna"))
        caption = PhotoCaption.objects.create(photo=photo)
        mock_caption.return_value = "caption"

        self.assertTrue(caption.generate_captions_im2txt(commit=False))
        prompt = mock_caption.call_args.kwargs["prompt"]
        self.assertIn("named Anna", prompt)
        self.assertNotIn("This photo was taken at", prompt)

    @override_config(CAPTIONING_MODEL="lfm2_vl_450m")
    @patch("api.models.photo_caption.generate_caption")
    def test_face_without_person_is_not_a_name(self, mock_caption):
        """An unrecognised face contributes nothing; a named one elsewhere still does."""
        from api.models import Face

        Face.objects.filter(photo=self.photo).delete()
        create_test_face(photo=self.photo, person=None)
        mock_caption.return_value = "caption"

        self.assertTrue(self.caption.generate_captions_im2txt(commit=False))
        prompt = mock_caption.call_args.kwargs["prompt"]
        self.assertNotIn("named", prompt)
        self.assertIn("This photo was taken at Berlin.", prompt)

        create_test_face(photo=self.photo, person=create_test_person(name="Bo"))
        self.assertTrue(self.caption.generate_captions_im2txt(commit=False))
        self.assertIn("named Bo", mock_caption.call_args.kwargs["prompt"])

    @override_config(CAPTIONING_MODEL="lfm2_vl_450m")
    @patch("api.models.photo_caption.generate_caption")
    def test_unresolvable_username_returns_false(self, mock_caption):
        from api.models import User

        User.objects.filter(pk=self.user.pk).update(username="renamed")
        mock_caption.return_value = "caption"

        self.assertFalse(self.caption.generate_captions_im2txt(commit=False))
        mock_caption.assert_not_called()
