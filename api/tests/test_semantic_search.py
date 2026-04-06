from unittest.mock import Mock, patch

import numpy as np
from django.test import SimpleTestCase

from api.semantic_search import calculate_query_embeddings, create_clip_embeddings


class SemanticSearchClientTest(SimpleTestCase):
    @patch("api.semantic_search.requests.post")
    def test_create_clip_embeddings_uses_multimodal_service(self, post_mock):
        post_mock.return_value = Mock(
            json=Mock(
                return_value={
                    "imgs_emb": [[1.0, 2.0], [3.0, 4.0]],
                    "magnitudes": [2.2360679, 5.0],
                }
            )
        )

        embeddings, magnitudes = create_clip_embeddings(["/tmp/a.jpg", "/tmp/b.jpg"])

        post_mock.assert_called_once_with(
            "http://localhost:8011/semantic-embeddings/image",
            json={"imgs": ["/tmp/a.jpg", "/tmp/b.jpg"]},
        )
        self.assertEqual(magnitudes, [2.2360679, 5.0])
        self.assertEqual([embedding.tolist() for embedding in embeddings], [[1.0, 2.0], [3.0, 4.0]])
        self.assertTrue(all(isinstance(embedding, np.ndarray) for embedding in embeddings))

    @patch("api.semantic_search.requests.post")
    def test_calculate_query_embeddings_uses_multimodal_service(self, post_mock):
        post_mock.return_value = Mock(
            json=Mock(return_value={"emb": [0.1, 0.2, 0.3], "magnitude": 0.37416574})
        )

        embedding, magnitude = calculate_query_embeddings("sunset")

        post_mock.assert_called_once_with(
            "http://localhost:8011/semantic-embeddings/text",
            json={"query": "sunset"},
        )
        self.assertEqual(embedding, [0.1, 0.2, 0.3])
        self.assertEqual(magnitude, 0.37416574)
