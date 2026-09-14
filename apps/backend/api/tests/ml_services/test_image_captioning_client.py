"""Tests for ``api.image_captioning.generate_caption``.

The client is thin: one sidecar, one URL, an optional prompt. What is pinned
is the exact payload, the timeout constant, and that errors propagate rather
than being swallowed (the caller decides what a failed caption means).
"""

from unittest.mock import MagicMock, patch

import requests
from django.test import TestCase

from api.http_timeouts import CAPTION, HEALTH_CHECK
from api.image_captioning import CAPTIONING_URL, generate_caption, unload_model


def _response(status_code=201, json_data=None, text=""):
    response = MagicMock()
    response.status_code = status_code
    response.text = text
    response.json.return_value = json_data if json_data is not None else {}
    return response


class GenerateCaptionTest(TestCase):
    @patch("api.image_captioning.requests.post")
    def test_happy_path_without_prompt(self, mock_post):
        mock_post.return_value = _response(json_data={"caption": "a dog"})

        result = generate_caption("/data/img.jpg")

        self.assertEqual(result, "a dog")
        mock_post.assert_called_once_with(
            CAPTIONING_URL, json={"image_path": "/data/img.jpg"}, timeout=CAPTION
        )

    @patch("api.image_captioning.requests.post")
    def test_prompt_is_forwarded(self, mock_post):
        mock_post.return_value = _response(json_data={"caption": "Anna's dog"})

        generate_caption("/data/img.jpg", prompt="The person is named Anna.")

        self.assertEqual(
            mock_post.call_args.kwargs["json"],
            {"image_path": "/data/img.jpg", "prompt": "The person is named Anna."},
        )

    @patch("api.image_captioning.requests.post")
    def test_empty_prompt_is_still_sent(self, mock_post):
        """Only ``None`` means "no prompt"; an empty string is the caller's choice."""
        mock_post.return_value = _response(json_data={"caption": "x"})

        generate_caption("/data/img.jpg", prompt="")

        self.assertEqual(mock_post.call_args.kwargs["json"]["prompt"], "")

    @patch("api.image_captioning.requests.post")
    def test_connection_error_propagates(self, mock_post):
        mock_post.side_effect = requests.exceptions.ConnectionError("refused")

        with self.assertRaises(requests.exceptions.ConnectionError):
            generate_caption("/data/img.jpg")

    @patch("api.image_captioning.requests.post")
    def test_missing_caption_key_raises_keyerror(self, mock_post):
        mock_post.return_value = _response(json_data={"error": "boom"})

        with self.assertRaises(KeyError):
            generate_caption("/data/img.jpg")


class UnloadModelTest(TestCase):
    @patch("api.image_captioning.requests.get")
    def test_unload_model_hits_the_sidecar(self, mock_get):
        self.assertIsNone(unload_model())
        mock_get.assert_called_once_with(
            "http://localhost:8007/unload-model", timeout=HEALTH_CHECK
        )
