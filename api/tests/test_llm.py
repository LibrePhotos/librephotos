from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from api.llm import generate_moondream_caption


class MoondreamCaptionClientTest(SimpleTestCase):
    @patch("api.llm.image_to_base64_data_uri")
    @patch("api.llm.requests.post")
    def test_generate_moondream_caption_posts_expected_payload(
        self, post_mock, image_to_base64_mock
    ):
        image_to_base64_mock.return_value = "data:image/jpeg;base64,abc"
        post_mock.return_value = Mock(
            status_code=201, json=Mock(return_value={"response": "A beach sunset"})
        )

        caption = generate_moondream_caption(
            prompt="Describe this image.", image_path="/tmp/test.jpg"
        )

        self.assertEqual(caption, "A beach sunset")
        post_mock.assert_called_once_with(
            "http://localhost:8008/generate",
            json={
                "model_path": "/protected_media/data_models/moondream2-text-model-f16.gguf",
                "max_tokens": 256,
                "prompt": "Describe this image.",
                "multimodal": True,
                "image_data": "data:image/jpeg;base64,abc",
            },
        )

    @patch("api.llm.image_to_base64_data_uri")
    @patch("api.llm.requests.post")
    def test_generate_moondream_caption_returns_none_on_http_error(
        self, post_mock, image_to_base64_mock
    ):
        image_to_base64_mock.return_value = "data:image/jpeg;base64,abc"
        post_mock.return_value = Mock(status_code=503, text="unavailable")

        caption = generate_moondream_caption(
            prompt="Describe this image.", image_path="/tmp/test.jpg"
        )

        self.assertIsNone(caption)
