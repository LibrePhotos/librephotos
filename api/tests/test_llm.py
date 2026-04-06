from unittest.mock import Mock, patch

from django.test import SimpleTestCase

from api.llm import generate_visual_caption


class VisualCaptionClientTest(SimpleTestCase):
    @patch("api.llm.image_to_base64_data_uri")
    @patch("api.llm.requests.post")
    @patch("api.llm.site_config")
    def test_generate_visual_caption_posts_expected_payload(
        self, site_config_mock, post_mock, image_to_base64_mock
    ):
        site_config_mock.CAPTIONING_MODEL = "smolvlm-256m"
        image_to_base64_mock.return_value = "data:image/jpeg;base64,abc"
        post_mock.return_value = Mock(
            status_code=201, json=Mock(return_value={"response": "A beach sunset"})
        )

        caption = generate_visual_caption(
            prompt="Describe this image.", image_path="/tmp/test.jpg"
        )

        self.assertEqual(caption, "A beach sunset")
        post_mock.assert_called_once_with(
            "http://localhost:8008/generate",
            json={
                "model_path": "/protected_media/data_models/SmolVLM-256M-Instruct-f16.gguf",
                "mmproj_path": "/protected_media/data_models/mmproj-SmolVLM-256M-Instruct-f16.gguf",
                "chat_format": "smolvlm",
                "max_tokens": 256,
                "prompt": "Describe this image.",
                "multimodal": True,
                "image_data": "data:image/jpeg;base64,abc",
            },
        )

    @patch("api.llm.image_to_base64_data_uri")
    @patch("api.llm.requests.post")
    @patch("api.llm.site_config")
    def test_generate_visual_caption_returns_none_on_http_error(
        self, site_config_mock, post_mock, image_to_base64_mock
    ):
        site_config_mock.CAPTIONING_MODEL = "smolvlm-256m"
        image_to_base64_mock.return_value = "data:image/jpeg;base64,abc"
        post_mock.return_value = Mock(status_code=503, text="unavailable")

        caption = generate_visual_caption(
            prompt="Describe this image.", image_path="/tmp/test.jpg"
        )

        self.assertIsNone(caption)

    @patch("api.llm.site_config")
    def test_generate_visual_caption_returns_none_when_captioning_disabled(
        self, site_config_mock
    ):
        site_config_mock.CAPTIONING_MODEL = "none"
        caption = generate_visual_caption(
            prompt="Describe this image.", image_path="/tmp/test.jpg"
        )
        self.assertIsNone(caption)
