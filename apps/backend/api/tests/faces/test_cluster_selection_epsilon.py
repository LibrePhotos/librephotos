"""The Cluster Selection Epsilon setting changes the clusters (#1996).

ArcFace encodings are stored as the model returns them: 512 numbers whose
length runs from about 13 to 25 with the quality of the face. On that scale
two faces of one person are ~19 apart, so the epsilons the settings page
offered (0 to 0.2) never merged anything. Clustering now reads them at unit
length (two faces of one person ~0.9 apart) and the choices moved with it.
The library below has the same shape as the 2,611-face one measured in the
issue: people with several looks, faces of mixed quality, siblings, and
strangers seen once.
"""

import numpy as np
from django.test import SimpleTestCase

from api.faces.classify import build_clusterer, classifier_input
from api.models import Cluster, Face, User
from api.models.cluster import unit_length

# The choices of the Cluster Selection Epsilon radio group in
# apps/frontend/src/components/settings/FaceOptionsCard.tsx, Off to Very High.
OFFERED_EPSILONS = (0.0, 0.9, 0.95, 1.0, 1.05)


def _unit(vector: np.ndarray) -> np.ndarray:
    return vector / np.linalg.norm(vector)


def synthetic_library(seed: int = 0, people: int = 24) -> tuple[list[str], list[int]]:
    """Stored (hex) encodings of a made-up library and who each face shows (-1: a stranger)."""
    rng = np.random.default_rng(seed)
    encodings: list[np.ndarray] = []
    who: list[int] = []
    center = _unit(rng.normal(size=512))
    for person in range(people):
        if person % 5 == 4:
            # A sibling of the previous person: half of their face is shared.
            center = _unit(0.5 * center + np.sqrt(0.75) * _unit(rng.normal(size=512)))
        else:
            center = _unit(rng.normal(size=512))
        # Looks of one person (age, glasses, lighting), each its own clump.
        looks = [
            _unit(a * center + np.sqrt(1 - a * a) * _unit(rng.normal(size=512)))
            for a in rng.uniform(0.6, 0.92, size=int(rng.integers(1, 5)))
        ]
        for _ in range(int(min(120, 3 + rng.pareto(1.2) * 10))):
            look = looks[int(rng.integers(len(looks)))]
            quality = rng.uniform(0, 1)
            closeness = 0.74 + 0.2 * quality
            face = _unit(
                closeness * look
                + np.sqrt(1 - closeness**2) * _unit(rng.normal(size=512))
            )
            # A worse face is a shorter vector, as ArcFace returns them.
            encodings.append(face * (13 + 12 * quality + rng.normal(0, 1)))
            who.append(person)
    for _ in range(len(encodings) // 3):
        encodings.append(_unit(rng.normal(size=512)) * rng.uniform(13, 20))
        who.append(-1)
    return [encoding.tobytes().hex() for encoding in encodings], who


class ClusterSelectionEpsilonTest(SimpleTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        stored, cls.who = synthetic_library()
        # Read back the way the clustering job reads them.
        cls.encodings = np.array(
            [Face(encoding=encoding).get_encoding_array() for encoding in stored]
        )
        cls.labels = {
            epsilon: cls.cluster(epsilon).tolist() for epsilon in OFFERED_EPSILONS
        }

    @classmethod
    def cluster(cls, epsilon: float) -> np.ndarray:
        user = User(
            min_cluster_size=0, min_samples=1, cluster_selection_epsilon=epsilon
        )
        return build_clusterer(user, len(cls.encodings)).fit(cls.encodings).labels_

    def cluster_count(self, epsilon: float) -> int:
        return len(set(self.labels[epsilon]) - {-1})

    def test_every_offered_epsilon_gives_different_clusters(self) -> None:
        counts = [self.cluster_count(epsilon) for epsilon in OFFERED_EPSILONS]
        for lower, higher in zip(OFFERED_EPSILONS, OFFERED_EPSILONS[1:]):
            self.assertTrue(
                self.labels[lower] != self.labels[higher],
                f"epsilon {lower} and {higher} cluster the same (clusters: {counts})",
            )

    def test_a_higher_epsilon_merges_clusters(self) -> None:
        counts = [self.cluster_count(epsilon) for epsilon in OFFERED_EPSILONS]
        self.assertEqual(counts, sorted(counts, reverse=True), counts)
        self.assertLess(counts[-1], counts[0], counts)

    def test_the_highest_epsilon_keeps_people_apart(self) -> None:
        """Very High merges the looks of one person, not siblings into one cluster."""
        labels = np.array(self.labels[OFFERED_EPSILONS[-1]])
        who = np.array(self.who)
        mixed = [
            label
            for label in set(labels.tolist()) - {-1}
            if len(set(who[labels == label].tolist()) - {-1}) > 1
        ]
        self.assertEqual(mixed, [])


class UnitLengthEncodingTest(SimpleTestCase):
    def test_a_face_encoding_is_read_at_unit_length(self) -> None:
        stored = (np.arange(1, 513, dtype=np.float64) / 20).tobytes().hex()

        encoding = Face(encoding=stored).get_encoding_array()

        self.assertAlmostEqual(float(np.linalg.norm(encoding)), 1.0)

    def test_a_zero_encoding_stays_zero(self) -> None:
        stored = np.zeros(512).tobytes().hex()

        encoding = Face(encoding=stored).get_encoding_array()

        np.testing.assert_array_equal(encoding, np.zeros(512))

    def test_a_cluster_mean_is_unit_length_even_when_saved_unscaled(self) -> None:
        unscaled_mean = (np.ones(512) * 0.9).tobytes().hex()

        mean = Cluster(mean_face_encoding=unscaled_mean).get_mean_encoding_array()

        self.assertAlmostEqual(float(np.linalg.norm(mean)), 1.0)

    def test_the_classifier_gets_encodings_spread_about_as_much_as_one(self) -> None:
        encodings = np.array([unit_length(np.arange(1.0, 513.0))] * 2)

        scaled = classifier_input(encodings)

        self.assertAlmostEqual(float(np.linalg.norm(scaled[0])), np.sqrt(512))
