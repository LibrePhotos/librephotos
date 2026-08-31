"""Characterization tests for ``api.image_captioning.generate_caption``.

These pin the CURRENT behavior of the captioning HTTP client before it is
refactored: which sidecar URL is called, the exact JSON payload, the timeout
constant, and each of the error strings the Moondream branch swallows.
"""

from unittest.mock import MagicMock, patch

import requests
from constance.test import override_config
from django.test import TestCase

from api.http_timeouts import CAPTION, HEALTH_CHECK
from api.image_captioning import generate_caption, unload_model

MOONDREAM_URL = "http://localhost:8008/generate"
IM2TXT_URL = "http://localhost:8007/generate-caption"
DEFAULT_MOONDREAM_PROMPT = "Describe this image in a short, concise caption."


def _response(status_code=201, json_data=None, text=""):
    response = MagicMock()
    response.status_code = status_code
    response.text = text
    response.json.return_value = json_data if json_data is not None else {}
    return response


@override_config(CAPTIONING_MODEL="moondream")
class GenerateCaptionMoondreamTest(TestCase):
    """The ``CAPTIONING_MODEL == "moondream"`` branch."""

    @patch("api.image_captioning.requests.post")
    def test_happy_path_returns_response_field(self, mock_post):
        mock_post.return_value = _response(json_data={"response": "a cat on a sofa"})

        result = generate_caption("/data/img.jpg")

        self.assertEqual(result, "a cat on a sofa")
        mock_post.assert_called_once_with(
            MOONDREAM_URL,
            json={
                "image_path": "/data/img.jpg",
                "prompt": DEFAULT_MOONDREAM_PROMPT,
                "max_tokens": 256,
            },
            timeout=CAPTION,
        )

    @patch("api.image_captioning.requests.post")
    def test_custom_prompt_overrides_default(self, mock_post):
        mock_post.return_value = _response(json_data={"response": "ok"})

        generate_caption("/data/img.jpg", prompt="What breed is this dog?")

        self.assertEqual(
            mock_post.call_args.kwargs["json"]["prompt"], "What breed is this dog?"
        )

    @patch("api.image_captioning.requests.post")
    def test_blip_flag_is_ignored_by_moondream_branch(self, mock_post):
        mock_post.return_value = _response(json_data={"response": "ok"})

        generate_caption("/data/img.jpg", blip=True)

        self.assertNotIn("blip", mock_post.call_args.kwargs["json"])

    @patch("api.image_captioning.requests.post")
    def test_empty_string_prompt_is_kept_as_is(self, mock_post):
        """Only ``None`` triggers the default prompt, not falsiness."""
        mock_post.return_value = _response(json_data={"response": "ok"})

        generate_caption("/data/img.jpg", prompt="")

        self.assertEqual(mock_post.call_args.kwargs["json"]["prompt"], "")

    @patch("api.image_captioning.requests.post")
    def test_non_201_status_returns_service_unavailable(self, mock_post):
        mock_post.return_value = _response(status_code=500, text="boom")

        result = generate_caption("/data/img.jpg")

        self.assertEqual(
            result, "Error generating caption with Moondream: Service unavailable"
        )

    @patch("api.image_captioning.requests.post")
    def test_status_200_is_also_treated_as_an_error(self, mock_post):
        """Current code only accepts 201; a plain 200 is an error."""
        mock_post.return_value = _response(status_code=200, json_data={"response": "x"})

        result = generate_caption("/data/img.jpg")

        self.assertEqual(
            result, "Error generating caption with Moondream: Service unavailable"
        )

    @patch("api.image_captioning.requests.post")
    def test_connection_error_returns_service_unavailable(self, mock_post):
        mock_post.side_effect = requests.exceptions.ConnectionError("refused")

        result = generate_caption("/data/img.jpg")

        self.assertEqual(
            result, "Error generating caption with Moondream: Service unavailable"
        )

    @patch("api.image_captioning.requests.post")
    def test_timeout_returns_request_timeout_message(self, mock_post):
        mock_post.side_effect = requests.exceptions.Timeout("slow")

        result = generate_caption("/data/img.jpg")

        self.assertEqual(
            result, "Error generating caption with Moondream: Request timeout"
        )

    @patch("api.image_captioning.requests.post")
    def test_generic_exception_returns_plain_error_message(self, mock_post):
        mock_post.side_effect = ValueError("bad json")

        result = generate_caption("/data/img.jpg")

        self.assertEqual(result, "Error generating caption with Moondream")

    @patch("api.image_captioning.requests.post")
    def test_missing_response_key_falls_into_generic_handler(self, mock_post):
        """A malformed payload raises KeyError inside the try -> generic message."""
        mock_post.return_value = _response(json_data={"caption": "wrong key"})

        result = generate_caption("/data/img.jpg")

        self.assertEqual(result, "Error generating caption with Moondream")

    @patch("api.image_captioning.requests.post")
    def test_http_error_subclass_is_swallowed_as_generic(self, mock_post):
        mock_post.side_effect = requests.exceptions.HTTPError("500")

        result = generate_caption("/data/img.jpg")

        self.assertEqual(result, "Error generating caption with Moondream")


class GenerateCaptionLegacyBranchTest(TestCase):
    """Every non-"moondream" model value falls through to the 8007 sidecar."""

    @override_config(CAPTIONING_MODEL="im2txt")
    @patch("api.image_captioning.requests.post")
    def test_im2txt_happy_path(self, mock_post):
        mock_post.return_value = _response(json_data={"caption": "a dog"})

        result = generate_caption("/data/img.jpg")

        self.assertEqual(result, "a dog")
        mock_post.assert_called_once_with(
            IM2TXT_URL,
            json={"image_path": "/data/img.jpg", "onnx": False, "blip": False},
            timeout=CAPTION,
        )

    @override_config(CAPTIONING_MODEL="blip_base_capfilt_large")
    @patch("api.image_captioning.requests.post")
    def test_blip_flag_is_forwarded(self, mock_post):
        mock_post.return_value = _response(json_data={"caption": "a dog"})

        generate_caption("/data/img.jpg", blip=True)

        self.assertEqual(mock_post.call_args.kwargs["json"]["blip"], True)

    @override_config(CAPTIONING_MODEL="im2txt")
    @patch("api.image_captioning.requests.post")
    def test_prompt_is_ignored_on_legacy_branch(self, mock_post):
        mock_post.return_value = _response(json_data={"caption": "a dog"})

        generate_caption("/data/img.jpg", prompt="ignore me")

        self.assertNotIn("prompt", mock_post.call_args.kwargs["json"])

    @override_config(CAPTIONING_MODEL="none")
    @patch("api.image_captioning.requests.post")
    def test_model_none_still_calls_the_legacy_sidecar(self, mock_post):
        """generate_caption itself has no "no model" guard; callers gate it."""
        mock_post.return_value = _response(json_data={"caption": "a dog"})

        result = generate_caption("/data/img.jpg")

        self.assertEqual(result, "a dog")
        self.assertEqual(mock_post.call_args.args[0], IM2TXT_URL)

    @override_config(CAPTIONING_MODEL="im2txt")
    @patch("api.image_captioning.requests.post")
    def test_connection_error_propagates_on_legacy_branch(self, mock_post):
        """Unlike Moondream, the legacy branch has no try/except."""
        mock_post.side_effect = requests.exceptions.ConnectionError("refused")

        with self.assertRaises(requests.exceptions.ConnectionError):
            generate_caption("/data/img.jpg")

    @override_config(CAPTIONING_MODEL="im2txt")
    @patch("api.image_captioning.requests.post")
    def test_missing_caption_key_raises_keyerror(self, mock_post):
        mock_post.return_value = _response(json_data={"response": "wrong key"})

        with self.assertRaises(KeyError):
            generate_caption("/data/img.jpg")


class UnloadModelTest(TestCase):
    @patch("api.image_captioning.requests.get")
    def test_unload_model_hits_the_sidecar(self, mock_get):
        self.assertIsNone(unload_model())
        mock_get.assert_called_once_with(
            "http://localhost:8007/unload-model", timeout=HEALTH_CHECK
        )
