"""Verify that every backend → sidecar HTTP call passes an explicit timeout.

`requests` has no default timeout, so a stalled sidecar (face-recognition
hung on a pathological image, exiftool wedged mid-process, etc.) parks
the caller on an infinite socket read. Long-running jobs then appear as
"running" forever without making progress.

These tests don't try to exercise the sidecar protocol — they just
intercept ``requests.{post,get,delete}`` for each caller and assert
that ``timeout=`` is set to a finite tuple. The timeout values are
defined in ``api.http_timeouts`` so tightening or relaxing them is a
one-place edit.
"""

from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from api import http_timeouts


def _ok_response(json_body=None):
    response = MagicMock()
    response.status_code = 200
    response.ok = True
    response.json.return_value = json_body or {}
    response.raise_for_status.return_value = None
    return response


def _assert_finite_timeout(call):
    """Both connect and read components must be set and finite."""
    timeout = call.kwargs.get("timeout")
    assert timeout is not None, f"call missing timeout=: {call}"
    if isinstance(timeout, tuple):
        connect, read = timeout
        assert connect > 0 and read > 0, f"non-positive timeout: {timeout}"
    else:
        assert timeout > 0, f"non-positive timeout: {timeout}"


class FaceRecognitionTimeoutTest(SimpleTestCase):
    @patch("api.face_recognition.requests.post")
    def test_get_face_locations_passes_timeout(self, mock_post):
        mock_post.return_value = _ok_response({"face_locations": []})

        from api.face_recognition import get_face_locations

        with patch("api.face_recognition.site_config") as mock_cfg:
            mock_cfg.FACE_RECOGNITION_MODEL = "buffalo_sc"
            get_face_locations("/tmp/photo.jpg")

        _assert_finite_timeout(mock_post.call_args)
        self.assertEqual(mock_post.call_args.kwargs["timeout"], http_timeouts.FACE)


class SemanticSearchTimeoutTest(SimpleTestCase):
    @patch("api.semantic_search.requests.post")
    def test_create_clip_embeddings_passes_timeout(self, mock_post):
        mock_post.return_value = _ok_response({"imgs_emb": [], "magnitudes": []})

        from api.semantic_search import create_clip_embeddings

        create_clip_embeddings([])

        _assert_finite_timeout(mock_post.call_args)
        self.assertEqual(
            mock_post.call_args.kwargs["timeout"], http_timeouts.CLIP_EMBED
        )

    @patch("api.semantic_search.requests.post")
    def test_calculate_query_embeddings_passes_timeout(self, mock_post):
        mock_post.return_value = _ok_response({"emb": [], "magnitude": 0})

        from api.semantic_search import calculate_query_embeddings

        calculate_query_embeddings("test")

        _assert_finite_timeout(mock_post.call_args)


class ExifReaderTimeoutTest(SimpleTestCase):
    @patch("api.metadata.reader.requests.post")
    @patch("api.metadata.reader._get_existing_metadata_files_reversed")
    def test_get_metadata_passes_timeout(self, mock_files, mock_post):
        mock_files.return_value = ["/tmp/photo.jpg"]
        mock_post.return_value = _ok_response({"values": [None, None]})

        from api.metadata.reader import get_metadata

        get_metadata("/tmp/photo.jpg", tags=["EXIF:Make", "EXIF:Model"])

        _assert_finite_timeout(mock_post.call_args)
        self.assertEqual(mock_post.call_args.kwargs["timeout"], http_timeouts.EXIF)


class ImageSimilarityTimeoutTest(SimpleTestCase):
    @patch("api.image_similarity.requests.post")
    def test_search_similar_embedding_passes_timeout(self, mock_post):
        mock_post.return_value = _ok_response({"result": []})

        from api.image_similarity import search_similar_embedding

        search_similar_embedding(user=1, emb=[0.0] * 512)

        _assert_finite_timeout(mock_post.call_args)
        self.assertEqual(
            mock_post.call_args.kwargs["timeout"], http_timeouts.SIMILARITY
        )


class ServicesHealthCheckTimeoutTest(SimpleTestCase):
    @patch("api.services.requests.get")
    def test_is_healthy_passes_timeout(self, mock_get):
        mock_get.return_value = _ok_response({"last_request_time": None})
        mock_get.return_value.status_code = 200

        from api.services import is_healthy

        is_healthy("image_similarity")

        _assert_finite_timeout(mock_get.call_args)
        self.assertEqual(
            mock_get.call_args.kwargs["timeout"], http_timeouts.HEALTH_CHECK
        )


class CaptionAndLLMTimeoutTest(SimpleTestCase):
    @patch("api.image_captioning.requests.post")
    def test_generate_caption_legacy_passes_timeout(self, mock_post):
        # Forces the non-moondream path which uses port 8007.
        mock_post.return_value = _ok_response({"caption": "x"})

        from api.image_captioning import generate_caption

        with patch("api.image_captioning.site_config") as mock_cfg:
            mock_cfg.CAPTIONING_MODEL = "im2txt"
            generate_caption("/tmp/photo.jpg")

        _assert_finite_timeout(mock_post.call_args)

    @patch("api.llm.requests.post")
    def test_llm_generate_passes_timeout(self, mock_post):
        response = _ok_response({"response": "hi"})
        response.status_code = 201
        mock_post.return_value = response

        from api.llm import generate_prompt

        with patch("api.llm.site_config") as mock_cfg:
            mock_cfg.LLM_MODEL = "mistral-7b-instruct-v0.2.Q5_K_M"
            generate_prompt("prompt")

        _assert_finite_timeout(mock_post.call_args)
        self.assertEqual(mock_post.call_args.kwargs["timeout"], http_timeouts.LLM_GEN)


class TimeoutPolicyTest(SimpleTestCase):
    """The numbers themselves are policy and should be sane."""

    def test_all_timeouts_are_finite_positive_tuples(self):
        for name in (
            "HEALTH_CHECK",
            "EXIF",
            "FACE",
            "SIMILARITY",
            "TAGS",
            "THUMBNAIL",
            "CLIP_EMBED",
            "CAPTION",
            "LLM_GEN",
        ):
            value = getattr(http_timeouts, name)
            self.assertIsInstance(value, tuple, f"{name} must be a tuple")
            self.assertEqual(len(value), 2, f"{name} must be (connect, read)")
            connect, read = value
            self.assertGreater(connect, 0, f"{name} connect timeout must be positive")
            self.assertGreater(read, 0, f"{name} read timeout must be positive")

    def test_connect_timeout_uniformly_short(self):
        # Local-socket connect should never legitimately take longer than a
        # few seconds. Keeping it uniform makes the policy easy to reason
        # about.
        for name in (
            "HEALTH_CHECK",
            "EXIF",
            "FACE",
            "SIMILARITY",
            "TAGS",
            "THUMBNAIL",
            "CLIP_EMBED",
            "CAPTION",
            "LLM_GEN",
        ):
            connect, _ = getattr(http_timeouts, name)
            self.assertLessEqual(connect, 10, f"{name} connect timeout too generous")
