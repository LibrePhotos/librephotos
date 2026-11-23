"""A user has one unknown face cluster (-1).

Reports from 1.6.0: "Multiple clusters found with id -1. Choosing first one".
Every face scan calls ``get_unknown_cluster``, a ``get_or_create`` without a
unique constraint behind it, so two workers scanning photos of one user at
once each created an unknown cluster.
"""

from django.db import IntegrityError, transaction
from django.test import TestCase

from api.models.cluster import UNKNOWN_CLUSTER_ID, Cluster, get_unknown_cluster
from api.tests.utils import create_test_cluster, create_test_user


class OneClusterPerIdTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()

    def test_a_second_unknown_cluster_cannot_be_created(self) -> None:
        get_unknown_cluster(self.user)

        with self.assertRaises(IntegrityError), transaction.atomic():
            create_test_cluster(self.user, cluster_id=UNKNOWN_CLUSTER_ID)

    def test_each_user_has_an_unknown_cluster_of_their_own(self) -> None:
        other = create_test_user()

        self.assertNotEqual(get_unknown_cluster(self.user), get_unknown_cluster(other))

    def test_other_cluster_ids_may_repeat(self) -> None:
        # A cluster of several people splits into one per person, same id.
        create_test_cluster(self.user, cluster_id=5, name="Cluster 5-1")
        create_test_cluster(self.user, cluster_id=5, name="Cluster 5-2")
        create_test_cluster(self.user, name="Anna")
        create_test_cluster(self.user, name="Ben")

        self.assertEqual(Cluster.objects.filter(owner=self.user).count(), 4)
