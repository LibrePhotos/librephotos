"""Characterization tests for ``api.llm.generate_prompt`` (CRAP unit 14).

These pin the CURRENT behavior of the model-dispatch / image-encoding /
HTTP-error branches of ``generate_prompt`` before refactoring. They assert
what the code does today, not what it arguably should do.

Known quirks pinned here (deliberately, not fixed):
  * Only the lowercase ``"none"`` is special-cased; every other unknown
    value (including the shipped capitalised default ``"None"``) also
    returns ``None``, but via the trailing ``else`` branch.
  * A successful call whose JSON body has no ``"response"`` key returns
    the empty string, not ``None``.
  * Any status code other than 201 -- including 200 -- is treated as an
    error and returns ``None``.
"""

import base64
import io
from unittest.mock import MagicMock, patch

import requests
from constance.test import override_config
from django.test import TestCase
from PIL import Image

from api import llm
from api.http_timeouts import LLM_GEN

MOONDREAM_PATH = "/protected_media/data_models/moondream2-text-model-f16.gguf"
MISTRAL_PATH = "/protected_media/data_models/mistral-7b-instruct-v0.2.Q5_K_M.gguf"


def _ok_response(payload, status=201):
    response = MagicMock()
    response.status_code = status
    response.text = "body-text"
    response.json.return_value = payload
    return response


class GeneratePromptModelDispatchTests(TestCase):
    """Which LLM_MODEL values reach the HTTP call, and with what model_path."""

    @override_config(LLM_MODEL="none")
    def test_model_none_lowercase_returns_none_without_http(self):
        with patch.object(llm.requests, "post") as post:
            self.assertIsNone(llm.generate_prompt("hello"))
        post.assert_not_called()

    @override_config(LLM_MODEL="None")
    def test_model_none_capitalised_default_also_returns_none(self):
        # Falls through the trailing else, not the explicit "none" check.
        with patch.object(llm.requests, "post") as post:
            self.assertIsNone(llm.generate_prompt("hello"))
        post.assert_not_called()

    @override_config(LLM_MODEL="some-unknown-model")
    def test_unknown_model_returns_none_without_http(self):
        with patch.object(llm.requests, "post") as post:
            self.assertIsNone(llm.generate_prompt("hello"))
        post.assert_not_called()

    @override_config(LLM_MODEL="moondream")
    def test_moondream_uses_moondream_gguf_path(self):
        with patch.object(
            llm.requests, "post", return_value=_ok_response({"response": "hi"})
        ) as post:
            self.assertEqual(llm.generate_prompt("describe this"), "hi")

        args, kwargs = post.call_args
        self.assertEqual(args[0], "http://localhost:8008/generate")
        self.assertEqual(
            kwargs["json"],
            {
                "model_path": MOONDREAM_PATH,
                "max_tokens": 64,
                "prompt": "describe this",
            },
        )
        self.assertEqual(kwargs["timeout"], LLM_GEN)

    @override_config(LLM_MODEL="mistral-7b-instruct-v0.2.Q5_K_M")
    def test_mistral_uses_mistral_gguf_path(self):
        with patch.object(
            llm.requests, "post", return_value=_ok_response({"response": "ok"})
        ) as post:
            self.assertEqual(llm.generate_prompt("prompt text"), "ok")

        self.assertEqual(post.call_args.kwargs["json"]["model_path"], MISTRAL_PATH)
        # No image -> no multimodal keys at all.
        self.assertNotIn("image_data", post.call_args.kwargs["json"])
        self.assertNotIn("multimodal", post.call_args.kwargs["json"])


@override_config(LLM_MODEL="moondream")
class GeneratePromptResponseHandlingTests(TestCase):
    """Status-code and payload handling on the HTTP response."""

    def test_201_returns_response_field(self):
        with patch.object(
            llm.requests,
            "post",
            return_value=_ok_response({"response": "a caption"}),
        ):
            self.assertEqual(llm.generate_prompt("p"), "a caption")

    def test_201_without_response_key_returns_empty_string(self):
        with patch.object(
            llm.requests, "post", return_value=_ok_response({"other": 1})
        ):
            self.assertEqual(llm.generate_prompt("p"), "")

    def test_status_200_is_treated_as_an_error(self):
        with patch.object(
            llm.requests,
            "post",
            return_value=_ok_response({"response": "ignored"}, status=200),
        ):
            self.assertIsNone(llm.generate_prompt("p"))

    def test_status_500_returns_none(self):
        with patch.object(
            llm.requests, "post", return_value=_ok_response({}, status=500)
        ):
            self.assertIsNone(llm.generate_prompt("p"))

    def test_connection_error_returns_none(self):
        with patch.object(
            llm.requests,
            "post",
            side_effect=requests.exceptions.ConnectionError("nope"),
        ):
            self.assertIsNone(llm.generate_prompt("p"))

    def test_timeout_returns_none(self):
        with patch.object(
            llm.requests,
            "post",
            side_effect=requests.exceptions.Timeout("slow"),
        ):
            self.assertIsNone(llm.generate_prompt("p"))

    def test_generic_exception_returns_none(self):
        with patch.object(llm.requests, "post", side_effect=ValueError("boom")):
            self.assertIsNone(llm.generate_prompt("p"))

    def test_invalid_json_body_returns_none(self):
        response = MagicMock()
        response.status_code = 201
        response.json.side_effect = ValueError("not json")
        with patch.object(llm.requests, "post", return_value=response):
            self.assertIsNone(llm.generate_prompt("p"))


@override_config(LLM_MODEL="moondream")
class GeneratePromptImagePathTests(TestCase):
    """The optional image_path branch."""

    def test_image_path_adds_data_uri_and_multimodal_flag(self):
        with (
            patch.object(
                llm,
                "image_to_base64_data_uri",
                return_value="data:image/jpeg;base64,AAA",
            ) as conv,
            patch.object(
                llm.requests, "post", return_value=_ok_response({"response": "r"})
            ) as post,
        ):
            self.assertEqual(llm.generate_prompt("p", "/some/img.jpg"), "r")

        conv.assert_called_once_with("/some/img.jpg")
        body = post.call_args.kwargs["json"]
        self.assertEqual(body["image_data"], "data:image/jpeg;base64,AAA")
        self.assertIs(body["multimodal"], True)

    def test_image_conversion_failure_returns_none_before_http(self):
        with (
            patch.object(
                llm, "image_to_base64_data_uri", side_effect=OSError("bad image")
            ),
            patch.object(llm.requests, "post") as post,
        ):
            self.assertIsNone(llm.generate_prompt("p", "/missing.jpg"))
        post.assert_not_called()

    def test_empty_string_image_path_is_falsy_and_skipped(self):
        with (
            patch.object(llm, "image_to_base64_data_uri") as conv,
            patch.object(
                llm.requests, "post", return_value=_ok_response({"response": "r"})
            ) as post,
        ):
            self.assertEqual(llm.generate_prompt("p", ""), "r")
        conv.assert_not_called()
        self.assertNotIn("image_data", post.call_args.kwargs["json"])

    def test_none_model_short_circuits_before_image_conversion(self):
        with override_config(LLM_MODEL="none"):
            with patch.object(llm, "image_to_base64_data_uri") as conv:
                self.assertIsNone(llm.generate_prompt("p", "/some/img.jpg"))
        conv.assert_not_called()


class ImageToBase64DataUriTests(TestCase):
    """Helper used by the image branch of generate_prompt."""

    def _write_png(self, mode="RGBA"):
        import tempfile

        img = Image.new(mode, (4, 4), color=(1, 2, 3, 255)[: len(mode)])
        fd = tempfile.NamedTemporaryFile(suffix=".png", delete=False)
        img.save(fd, format="PNG")
        fd.close()
        return fd.name

    def test_converts_rgba_png_to_jpeg_data_uri(self):
        path = self._write_png("RGBA")
        uri = llm.image_to_base64_data_uri(path)
        self.assertTrue(uri.startswith("data:image/jpeg;base64,"))
        raw = base64.b64decode(uri.split(",", 1)[1])
        with Image.open(io.BytesIO(raw)) as out:
            self.assertEqual(out.format, "JPEG")
            self.assertEqual(out.size, (4, 4))

    def test_missing_file_raises(self):
        with self.assertRaises(Exception):
            llm.image_to_base64_data_uri("/definitely/not/here.jpg")
