"""Tests for the opt-in TwelveLabs Marengo embedding provider.

The provider is selected via the ``EMBEDDING_PROVIDER`` constance setting. When
it is ``"local"`` (the default) nothing in the existing CLIP path changes; when
it is ``"twelvelabs_marengo"`` and an API key is set, image/video/query
embeddings are routed through ``api.marengo``.

The unit tests below mock the TwelveLabs SDK so they never hit the network.
``test_live_text_embedding`` runs only when ``TWELVELABS_API_KEY`` is set and
performs a real Marengo text embedding call to verify the wiring end to end.
"""

import os
from unittest.mock import MagicMock, patch

from constance.test import override_config
from django.test import SimpleTestCase

from api import marengo


def _fake_segment(values):
    seg = MagicMock()
    seg.float_ = values
    return seg


class MarengoEnabledTest(SimpleTestCase):
    @override_config(EMBEDDING_PROVIDER="local", TWELVELABS_API_KEY="")
    def test_disabled_by_default(self):
        self.assertFalse(marengo.is_enabled())

    @override_config(EMBEDDING_PROVIDER="twelvelabs_marengo", TWELVELABS_API_KEY="")
    def test_disabled_without_key(self):
        # Selecting the provider but leaving the key blank must not enable it.
        self.assertFalse(marengo.is_enabled())

    @override_config(
        EMBEDDING_PROVIDER="twelvelabs_marengo", TWELVELABS_API_KEY="secret"
    )
    def test_enabled_with_provider_and_key(self):
        self.assertTrue(marengo.is_enabled())


class MarengoEmbeddingShapeTest(SimpleTestCase):
    def setUp(self):
        # Reset the cached client between tests.
        marengo._client = None

    def tearDown(self):
        marengo._client = None

    @override_config(
        EMBEDDING_PROVIDER="twelvelabs_marengo", TWELVELABS_API_KEY="secret"
    )
    def test_embed_text_returns_vector_and_magnitude(self):
        fake_client = MagicMock()
        resp = MagicMock()
        resp.text_embedding.segments = [_fake_segment([3.0, 4.0])]
        fake_client.embed.create.return_value = resp

        with patch.object(marengo, "_get_client", return_value=fake_client):
            emb, magnitude = marengo.embed_text("a dog")

        self.assertEqual(emb, [3.0, 4.0])
        self.assertAlmostEqual(magnitude, 5.0)  # ||(3, 4)|| == 5
        fake_client.embed.create.assert_called_once()
        kwargs = fake_client.embed.create.call_args.kwargs
        self.assertEqual(kwargs["model_name"], marengo.MARENGO_MODEL_NAME)
        self.assertEqual(kwargs["text"], "a dog")

    @override_config(
        EMBEDDING_PROVIDER="twelvelabs_marengo", TWELVELABS_API_KEY="secret"
    )
    def test_embed_video_requests_video_scope_and_polls(self):
        fake_client = MagicMock()
        created = MagicMock(id="task-1")
        fake_client.embed.tasks.create.return_value = created
        done = MagicMock(id="task-1", status="ready")
        fake_client.embed.tasks.wait_for_done.return_value = done
        retrieved = MagicMock()
        retrieved.video_embedding.segments = [_fake_segment([0.0, 1.0])]
        fake_client.embed.tasks.retrieve.return_value = retrieved

        with patch.object(marengo, "_get_client", return_value=fake_client):
            with patch("builtins.open", new=MagicMock()):
                emb, magnitude = marengo.embed_video("/tmp/clip.mp4")

        self.assertEqual(emb, [0.0, 1.0])
        self.assertAlmostEqual(magnitude, 1.0)
        create_kwargs = fake_client.embed.tasks.create.call_args.kwargs
        self.assertEqual(create_kwargs["video_embedding_scope"], marengo._VIDEO_SCOPE)
        fake_client.embed.tasks.wait_for_done.assert_called_once_with(task_id="task-1")

    @override_config(
        EMBEDDING_PROVIDER="twelvelabs_marengo", TWELVELABS_API_KEY="secret"
    )
    def test_video_task_failure_raises(self):
        fake_client = MagicMock()
        fake_client.embed.tasks.create.return_value = MagicMock(id="task-2")
        fake_client.embed.tasks.wait_for_done.return_value = MagicMock(
            id="task-2", status="failed"
        )

        with patch.object(marengo, "_get_client", return_value=fake_client):
            with patch("builtins.open", new=MagicMock()):
                with self.assertRaises(RuntimeError):
                    marengo.embed_video("/tmp/clip.mp4")


class SemanticSearchRoutingTest(SimpleTestCase):
    """The semantic_search entry points must route to Marengo only when enabled."""

    @override_config(EMBEDDING_PROVIDER="local", TWELVELABS_API_KEY="")
    def test_query_falls_through_to_local_when_disabled(self):
        from api.semantic_search import calculate_query_embeddings

        with patch("api.semantic_search.requests.post") as mock_post:
            mock_post.return_value.json.return_value = {"emb": [1.0], "magnitude": 1.0}
            calculate_query_embeddings("test")

        mock_post.assert_called_once()  # local CLIP sidecar was used

    @override_config(
        EMBEDDING_PROVIDER="twelvelabs_marengo", TWELVELABS_API_KEY="secret"
    )
    def test_query_routes_to_marengo_when_enabled(self):
        from api.semantic_search import calculate_query_embeddings

        with patch("api.marengo.embed_text", return_value=([0.5], 0.5)) as mock_embed:
            with patch("api.semantic_search.requests.post") as mock_post:
                emb, magnitude = calculate_query_embeddings("test")

        mock_embed.assert_called_once_with("test")
        mock_post.assert_not_called()  # local sidecar must not be hit
        self.assertEqual((emb, magnitude), ([0.5], 0.5))


class MarengoLiveTest(SimpleTestCase):
    @override_config(EMBEDDING_PROVIDER="twelvelabs_marengo")
    def test_live_text_embedding(self):
        api_key = os.environ.get("TWELVELABS_API_KEY")
        if not api_key:
            self.skipTest("TWELVELABS_API_KEY not set; skipping live Marengo call")

        marengo._client = None
        with override_config(TWELVELABS_API_KEY=api_key):
            emb, magnitude = marengo.embed_text("a dog playing in the park")
        marengo._client = None

        self.assertEqual(len(emb), marengo.MARENGO_EMBED_DIM)
        self.assertGreater(magnitude, 0.0)
