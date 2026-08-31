"""Characterization tests for PhotoCaption caption-generation (CRAP unit 22).

Pins the *current* behavior of:
  * ``PhotoCaption.generate_captions_im2txt``
  * ``PhotoCaption._generate_captions_moondream``

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

    @override_config(CAPTIONING_MODEL="im2txt")
    @patch("api.models.photo_caption.generate_caption")
    def test_empty_thumbnail_big_returns_false(self, mock_generate_caption):
        thumb = self.photo.thumbnail
        thumb.thumbnail_big = ""
        thumb.save()
        self.photo.refresh_from_db()

        caption = PhotoCaption.objects.get(pk=self.caption.pk)
        self.assertFalse(caption.generate_captions_im2txt(commit=False))
        mock_generate_caption.assert_not_called()

    @override_config(CAPTIONING_MODEL="im2txt")
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

    @override_config(CAPTIONING_MODEL="moondream")
    def test_moondream_model_delegates_and_returns_its_result(self):
        with patch.object(
            PhotoCaption, "_generate_captions_moondream", return_value="sentinel"
        ) as mock_moondream:
            result = self.caption.generate_captions_im2txt(commit=False)
        self.assertEqual(result, "sentinel")
        mock_moondream.assert_called_once_with(commit=False)

    @override_config(CAPTIONING_MODEL="moondream")
    def test_moondream_delegation_forwards_commit_true(self):
        with patch.object(
            PhotoCaption, "_generate_captions_moondream", return_value=True
        ) as mock_moondream:
            self.caption.generate_captions_im2txt(commit=True)
        mock_moondream.assert_called_once_with(commit=True)


@override_settings(FEATURE_IMAGE_CAPTIONING=True)
class Im2txtGenerationTest(TestCase):
    """The im2txt / blip caption path with the LLM rewrite disabled."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        self.caption = PhotoCaption.objects.create(photo=self.photo)

    @override_config(CAPTIONING_MODEL="im2txt", LLM_MODEL="none")
    @patch("api.models.photo_caption.generate_caption")
    def test_im2txt_happy_path_strips_markers_and_saves(self, mock_generate_caption):
        mock_generate_caption.return_value = "  <start> a photo of a cat <end>  "

        result = self.caption.generate_captions_im2txt(commit=True)

        self.assertTrue(result)
        self.assertEqual(mock_generate_caption.call_count, 1)
        kwargs = mock_generate_caption.call_args.kwargs
        self.assertFalse(kwargs["blip"])
        self.assertTrue(kwargs["image_path"].endswith(".webp"))
        self.assertEqual(self.caption.captions_json["im2txt"], "a photo of a cat")

        self.caption.refresh_from_db()
        self.assertEqual(self.caption.captions_json["im2txt"], "a photo of a cat")

    @override_config(CAPTIONING_MODEL="blip_base_capfilt_large", LLM_MODEL="none")
    @patch("api.models.photo_caption.generate_caption")
    def test_blip_model_sets_blip_flag(self, mock_generate_caption):
        mock_generate_caption.return_value = "a blip caption"

        self.assertTrue(self.caption.generate_captions_im2txt(commit=False))
        self.assertTrue(mock_generate_caption.call_args.kwargs["blip"])

    @override_config(CAPTIONING_MODEL="im2txt", LLM_MODEL="none")
    @patch("api.models.photo_caption.generate_caption")
    def test_commit_false_does_not_persist_caption(self, mock_generate_caption):
        mock_generate_caption.return_value = "not persisted"

        self.assertTrue(self.caption.generate_captions_im2txt(commit=False))
        self.assertEqual(self.caption.captions_json["im2txt"], "not persisted")

        fresh = PhotoCaption.objects.get(pk=self.caption.pk)
        self.assertIsNone(fresh.captions_json)

    @override_config(CAPTIONING_MODEL="im2txt", LLM_MODEL="none")
    @patch("api.models.photo_caption.generate_caption")
    def test_existing_caption_keys_are_preserved(self, mock_generate_caption):
        self.caption.captions_json = {"user_caption": "mine", "im2txt": "old"}
        self.caption.save()
        mock_generate_caption.return_value = "new caption"

        self.assertTrue(self.caption.generate_captions_im2txt(commit=True))
        self.caption.refresh_from_db()
        self.assertEqual(self.caption.captions_json["user_caption"], "mine")
        self.assertEqual(self.caption.captions_json["im2txt"], "new caption")

    @override_config(CAPTIONING_MODEL="im2txt", LLM_MODEL="none")
    @patch("api.models.photo_caption.generate_caption")
    def test_generate_caption_exception_returns_false(self, mock_generate_caption):
        mock_generate_caption.side_effect = RuntimeError("model exploded")

        self.assertFalse(self.caption.generate_captions_im2txt(commit=True))
        fresh = PhotoCaption.objects.get(pk=self.caption.pk)
        self.assertIsNone(fresh.captions_json)

    @override_config(CAPTIONING_MODEL="im2txt", LLM_MODEL="none")
    @patch("api.models.photo_caption.generate_caption")
    def test_non_string_caption_result_returns_false(self, mock_generate_caption):
        # ``.replace`` on a non-str blows up inside the try -> swallowed.
        mock_generate_caption.return_value = None

        self.assertFalse(self.caption.generate_captions_im2txt(commit=False))

    @override_config(CAPTIONING_MODEL="im2txt", LLM_MODEL="none")
    @patch("api.models.photo_caption.generate_caption")
    def test_recreate_search_captions_is_invoked(self, mock_generate_caption):
        mock_generate_caption.return_value = "a photo of a cat"

        self.assertTrue(self.caption.generate_captions_im2txt(commit=True))

        from api.models.photo_search import PhotoSearch

        search = PhotoSearch.objects.get(photo=self.photo)
        self.assertIn("a photo of a cat", search.search_captions)


@override_settings(FEATURE_IMAGE_CAPTIONING=True)
class Im2txtLlmRewriteTest(TestCase):
    """The LLM prompt-rewrite branch of generate_captions_im2txt."""

    def setUp(self):
        self.user = create_test_user()
        self.user.llm_settings = _llm_settings(
            enabled=True, add_person=True, add_location=True, add_keywords=True
        )
        self.user.save()
        self.photo = create_test_photo(owner=self.user, search_location="Berlin")
        self.caption = PhotoCaption.objects.create(photo=self.photo)
        self.person = create_test_person(name="Anna")
        create_test_face(photo=self.photo, person=self.person)

    @override_config(CAPTIONING_MODEL="im2txt", LLM_MODEL="some-llm")
    @patch("api.models.photo_caption.generate_prompt")
    @patch("api.models.photo_caption.generate_caption")
    def test_prompt_contains_caption_place_and_person(self, mock_caption, mock_prompt):
        mock_caption.return_value = "a photo of a cat"
        mock_prompt.return_value = "Anna's cat in Berlin"

        self.assertTrue(self.caption.generate_captions_im2txt(commit=False))

        prompt = mock_prompt.call_args.args[0]
        self.assertIn(
            "Q: Your task is to improve the following image caption: ", prompt
        )
        self.assertIn("a photo of a cat", prompt)
        self.assertIn(" Place: Berlin", prompt)
        self.assertIn(" Person: Anna", prompt)
        self.assertIn(" and tags or keywords", prompt)
        self.assertTrue(prompt.endswith(". \n A:"))
        self.assertEqual(self.caption.captions_json["im2txt"], "Anna's cat in Berlin")

    @override_config(CAPTIONING_MODEL="im2txt", LLM_MODEL="some-llm")
    @patch("api.models.photo_caption.generate_prompt")
    @patch("api.models.photo_caption.generate_caption")
    def test_flags_off_omit_place_person_and_keywords(self, mock_caption, mock_prompt):
        self.user.llm_settings = _llm_settings(enabled=True)
        self.user.save()
        mock_caption.return_value = "a photo of a cat"
        mock_prompt.return_value = "rewritten"

        self.assertTrue(self.caption.generate_captions_im2txt(commit=False))

        prompt = mock_prompt.call_args.args[0]
        self.assertNotIn("Place:", prompt)
        self.assertNotIn("Person:", prompt)
        self.assertNotIn("keywords", prompt)

    @override_config(CAPTIONING_MODEL="im2txt", LLM_MODEL="some-llm")
    @patch("api.models.photo_caption.generate_prompt")
    @patch("api.models.photo_caption.generate_caption")
    def test_llm_settings_disabled_skips_rewrite(self, mock_caption, mock_prompt):
        self.user.llm_settings = _llm_settings(enabled=False)
        self.user.save()
        mock_caption.return_value = "a photo of a cat"

        self.assertTrue(self.caption.generate_captions_im2txt(commit=False))
        mock_prompt.assert_not_called()
        self.assertEqual(self.caption.captions_json["im2txt"], "a photo of a cat")

    @override_config(CAPTIONING_MODEL="im2txt", LLM_MODEL="some-llm")
    @patch("api.models.photo_caption.generate_prompt")
    @patch("api.models.photo_caption.generate_caption")
    def test_no_face_omits_person_but_keeps_place(self, mock_caption, mock_prompt):
        from api.models import Face

        Face.objects.filter(photo=self.photo).delete()
        mock_caption.return_value = "a photo of a cat"
        mock_prompt.return_value = "rewritten"

        self.assertTrue(self.caption.generate_captions_im2txt(commit=False))
        prompt = mock_prompt.call_args.args[0]
        self.assertNotIn("Person:", prompt)
        self.assertIn(" Place: Berlin", prompt)

    @override_config(CAPTIONING_MODEL="im2txt", LLM_MODEL="some-llm")
    @patch("api.models.photo_caption.generate_prompt")
    @patch("api.models.photo_caption.generate_caption")
    def test_missing_search_instance_returns_false(self, mock_caption, mock_prompt):
        """BUG (pinned): with the LLM branch active and no PhotoSearch row,
        ``self.photo.search_instance`` raises RelatedObjectDoesNotExist, which the
        blanket ``except Exception`` swallows -> the whole captioning silently fails."""
        photo = create_test_photo(owner=self.user)  # no search_location -> no row
        caption = PhotoCaption.objects.create(photo=photo)
        mock_caption.return_value = "a photo of a cat"
        mock_prompt.return_value = "rewritten"

        self.assertFalse(caption.generate_captions_im2txt(commit=False))
        mock_prompt.assert_not_called()

    @override_config(CAPTIONING_MODEL="im2txt", LLM_MODEL="some-llm")
    @patch("api.models.photo_caption.generate_prompt")
    @patch("api.models.photo_caption.generate_caption")
    def test_generate_prompt_exception_returns_false(self, mock_caption, mock_prompt):
        mock_caption.return_value = "a photo of a cat"
        mock_prompt.side_effect = RuntimeError("llm down")

        self.assertFalse(self.caption.generate_captions_im2txt(commit=True))
        fresh = PhotoCaption.objects.get(pk=self.caption.pk)
        self.assertIsNone(fresh.captions_json)


@override_settings(FEATURE_IMAGE_CAPTIONING=True)
class MoondreamTest(TestCase):
    """_generate_captions_moondream, called directly."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        self.caption = PhotoCaption.objects.create(photo=self.photo)

    @patch("api.models.photo_caption.generate_prompt")
    def test_empty_thumbnail_big_returns_false(self, mock_prompt):
        thumb = self.photo.thumbnail
        thumb.thumbnail_big = ""
        thumb.save()

        caption = PhotoCaption.objects.get(pk=self.caption.pk)
        self.assertFalse(caption._generate_captions_moondream(commit=False))
        mock_prompt.assert_not_called()

    @patch("api.models.photo_caption.generate_prompt")
    def test_unreadable_thumbnail_path_returns_false(self, mock_prompt):
        with patch(
            "django.db.models.fields.files.FieldFile.path",
            new_callable=PropertyMock,
            side_effect=ValueError("no path"),
        ):
            self.assertFalse(self.caption._generate_captions_moondream(commit=False))
        mock_prompt.assert_not_called()

    @override_config(LLM_MODEL="none")
    @patch("api.models.photo_caption.generate_prompt")
    def test_default_prompt_when_llm_model_none(self, mock_prompt):
        mock_prompt.return_value = " <start>a cat<end> "

        self.assertTrue(self.caption._generate_captions_moondream(commit=True))

        kwargs = mock_prompt.call_args.kwargs
        self.assertEqual(
            kwargs["prompt"], "Describe this image in a short, natural image caption."
        )
        self.assertTrue(kwargs["image_path"].endswith(".webp"))
        self.caption.refresh_from_db()
        self.assertEqual(self.caption.captions_json["im2txt"], "a cat")

    @override_config(LLM_MODEL="some-llm")
    @patch("api.models.photo_caption.generate_prompt")
    def test_default_prompt_when_llm_settings_disabled(self, mock_prompt):
        mock_prompt.return_value = "a cat"

        self.assertTrue(self.caption._generate_captions_moondream(commit=False))
        self.assertEqual(
            mock_prompt.call_args.kwargs["prompt"],
            "Describe this image in a short, natural image caption.",
        )

    @override_config(LLM_MODEL="none")
    @patch("api.models.photo_caption.generate_prompt")
    def test_commit_false_does_not_persist(self, mock_prompt):
        mock_prompt.return_value = "a cat"

        self.assertTrue(self.caption._generate_captions_moondream(commit=False))
        self.assertEqual(self.caption.captions_json["im2txt"], "a cat")
        self.assertIsNone(PhotoCaption.objects.get(pk=self.caption.pk).captions_json)

    @override_config(LLM_MODEL="none")
    @patch("api.models.photo_caption.generate_prompt")
    def test_existing_keys_preserved(self, mock_prompt):
        self.caption.captions_json = {"user_caption": "mine"}
        self.caption.save()
        mock_prompt.return_value = "a cat"

        self.assertTrue(self.caption._generate_captions_moondream(commit=True))
        self.caption.refresh_from_db()
        self.assertEqual(self.caption.captions_json["user_caption"], "mine")
        self.assertEqual(self.caption.captions_json["im2txt"], "a cat")

    @override_config(LLM_MODEL="none")
    @patch("api.models.photo_caption.generate_prompt")
    def test_generate_prompt_exception_returns_false(self, mock_prompt):
        mock_prompt.side_effect = RuntimeError("moondream down")

        self.assertFalse(self.caption._generate_captions_moondream(commit=True))
        self.assertIsNone(PhotoCaption.objects.get(pk=self.caption.pk).captions_json)

    @override_config(LLM_MODEL="none")
    @patch("api.models.photo_caption.generate_prompt")
    def test_non_string_result_returns_false(self, mock_prompt):
        mock_prompt.return_value = None

        self.assertFalse(self.caption._generate_captions_moondream(commit=False))

    @override_config(LLM_MODEL="none")
    @patch("api.models.photo_caption.generate_prompt")
    def test_recreate_search_captions_is_invoked(self, mock_prompt):
        mock_prompt.return_value = "a cat"

        self.assertTrue(self.caption._generate_captions_moondream(commit=True))

        from api.models.photo_search import PhotoSearch

        self.assertIn(
            "a cat", PhotoSearch.objects.get(photo=self.photo).search_captions
        )

    @patch("api.models.photo_caption.generate_prompt")
    def test_unresolvable_username_returns_false(self, mock_prompt):
        """The owner is re-fetched by ``username=self.photo.owner`` (a string
        lookup, not the FK id). A stale in-memory username therefore makes the
        lookup raise User.DoesNotExist, which the blanket except turns into
        ``False``."""
        from api.models import User

        User.objects.filter(pk=self.user.pk).update(username="renamed-owner")
        mock_prompt.return_value = "a cat"

        self.assertFalse(self.caption._generate_captions_moondream(commit=False))
        mock_prompt.assert_not_called()


@override_settings(FEATURE_IMAGE_CAPTIONING=True)
class MoondreamEnhancedPromptTest(TestCase):
    """The enhanced-prompt branch of _generate_captions_moondream."""

    def setUp(self):
        self.user = create_test_user()
        self.user.llm_settings = _llm_settings(
            enabled=True, add_person=True, add_location=True, add_keywords=True
        )
        self.user.save()
        self.photo = create_test_photo(owner=self.user, search_location="Berlin")
        self.caption = PhotoCaption.objects.create(photo=self.photo)
        create_test_face(photo=self.photo, person=create_test_person(name="Anna"))

    @override_config(LLM_MODEL="some-llm")
    @patch("api.models.photo_caption.generate_prompt")
    def test_full_enhanced_prompt(self, mock_prompt):
        mock_prompt.return_value = "Anna in Berlin"

        self.assertTrue(self.caption._generate_captions_moondream(commit=False))

        prompt = mock_prompt.call_args.kwargs["prompt"]
        self.assertTrue(prompt.startswith("Write a short, natural image caption."))
        self.assertIn("The person in the photo is named Anna.", prompt)
        self.assertIn("Use the name 'Anna' directly in the caption", prompt)
        self.assertIn("This photo was taken at Berlin.", prompt)
        self.assertIn("Include relevant tags and keywords.", prompt)
        self.assertEqual(self.caption.captions_json["im2txt"], "Anna in Berlin")

    @override_config(LLM_MODEL="some-llm")
    @patch("api.models.photo_caption.generate_prompt")
    def test_person_omitted_when_add_person_false(self, mock_prompt):
        self.user.llm_settings = _llm_settings(enabled=True, add_location=True)
        self.user.save()
        mock_prompt.return_value = "caption"

        self.assertTrue(self.caption._generate_captions_moondream(commit=False))
        prompt = mock_prompt.call_args.kwargs["prompt"]
        self.assertNotIn("Anna", prompt)
        self.assertIn("This photo was taken at Berlin.", prompt)
        self.assertNotIn("Include relevant tags", prompt)

    @override_config(LLM_MODEL="some-llm")
    @patch("api.models.photo_caption.generate_prompt")
    def test_place_omitted_when_no_face_and_no_flags(self, mock_prompt):
        from api.models import Face

        Face.objects.filter(photo=self.photo).delete()
        self.user.llm_settings = _llm_settings(enabled=True, add_person=True)
        self.user.save()
        mock_prompt.return_value = "caption"

        self.assertTrue(self.caption._generate_captions_moondream(commit=False))
        self.assertEqual(
            mock_prompt.call_args.kwargs["prompt"],
            "Write a short, natural image caption.",
        )

    @override_config(LLM_MODEL="some-llm")
    @patch("api.models.photo_caption.generate_prompt")
    def test_missing_search_instance_returns_false(self, mock_prompt):
        """BUG (pinned): same swallowed RelatedObjectDoesNotExist as im2txt."""
        photo = create_test_photo(owner=self.user)
        caption = PhotoCaption.objects.create(photo=photo)
        mock_prompt.return_value = "caption"

        self.assertFalse(caption._generate_captions_moondream(commit=False))
        mock_prompt.assert_not_called()

    @override_config(LLM_MODEL="some-llm")
    @patch("api.models.photo_caption.generate_prompt")
    def test_face_without_person_returns_false(self, mock_prompt):
        """BUG (pinned): a Face with no Person makes ``face.person.name`` raise."""
        from api.models import Face

        Face.objects.filter(photo=self.photo).delete()
        create_test_face(photo=self.photo, person=None)
        mock_prompt.return_value = "caption"

        self.assertFalse(self.caption._generate_captions_moondream(commit=False))
        mock_prompt.assert_not_called()
