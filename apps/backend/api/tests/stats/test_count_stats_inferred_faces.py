"""Tests for the ``num_inferred_faces`` count in ``api.stats.get_count_stats``.

The filter read ``Q(person=True)``. Django resolves a boolean given to a
ForeignKey lookup as a primary key, so ``person=True`` becomes ``person_id=1``:
the statistic reported "faces belonging to person number 1" rather than faces
whose person was inferred. Sitting one line below ``num_labeled_faces``, which
counts ``person__isnull=False``, the intended meaning is that count's
complement - the faces the user has not labelled, the ones the face dashboard
offers under its Inferred tab, where every branch pairs the cluster or
classification guess with ``person=None``.

The figure is shown to the user in the hover card on the people/faces card,
next to Labeled and Unknown.
"""

from django.test import TestCase

from api.models import Person
from api.stats import get_count_stats
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


class CountStatsInferredFacesTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def test_an_unlabelled_face_is_inferred(self):
        create_test_face(photo=self.photo, person=None)

        self.assertEqual(get_count_stats(self.user)["num_inferred_faces"], 1)

    def test_a_labelled_face_is_not_inferred(self):
        create_test_face(photo=self.photo, person=create_test_person(name="Alice"))

        self.assertEqual(get_count_stats(self.user)["num_inferred_faces"], 0)

    def test_the_count_is_not_person_number_ones_face_count(self):
        """The bug in its own right.

        ``person=True`` resolves to ``person_id=1``, so the faces of whichever
        person happens to hold primary key 1 were reported as inferred - and the
        genuinely unlabelled faces were not counted at all. Person 1 is created
        explicitly here so the arrangement does not depend on insertion order.
        """
        person_one = create_test_person(name="Alice", id=1)
        self.assertEqual(person_one.pk, 1, "this test needs to own primary key 1")
        create_test_face(photo=self.photo, person=person_one)
        create_test_face(photo=self.photo, person=None)
        create_test_face(photo=self.photo, person=None)

        stats = get_count_stats(self.user)

        self.assertEqual(stats["num_inferred_faces"], 2)
        self.assertEqual(stats["num_labeled_faces"], 1)

    def test_inferred_and_labelled_account_for_every_visible_face(self):
        """The hover card shows these two side by side, so they must partition
        the faces on the owner's visible photos rather than overlap or leave a
        gap."""
        create_test_face(photo=self.photo, person=create_test_person(name="Alice"))
        create_test_face(photo=self.photo, person=None)
        create_test_face(
            photo=self.photo,
            person=None,
            cluster_person=create_test_person(
                name="Unknown 001", kind=Person.KIND_CLUSTER, cluster_owner=self.user
            ),
        )

        stats = get_count_stats(self.user)

        self.assertEqual(
            stats["num_inferred_faces"] + stats["num_labeled_faces"],
            stats["num_faces"],
        )

    def test_a_face_on_a_hidden_photo_is_not_counted(self):
        """``num_labeled_faces`` excludes hidden photos; this must match."""
        hidden = create_test_photo(owner=self.user, hidden=True)
        create_test_face(photo=hidden, person=None)

        self.assertEqual(get_count_stats(self.user)["num_inferred_faces"], 0)

    def test_another_users_unlabelled_face_is_not_counted(self):
        stranger = create_test_user()
        create_test_face(photo=create_test_photo(owner=stranger), person=None)

        self.assertEqual(get_count_stats(self.user)["num_inferred_faces"], 0)

    def test_a_deleted_face_the_user_never_labelled_still_counts_once(self):
        """Pins current behaviour rather than asking for a change: none of the
        face counts in this dict filter on ``deleted``, so a deleted face is
        still part of ``num_faces`` and stays part of this count too. Changing
        that belongs with a change to the whole group."""
        create_test_face(photo=self.photo, person=None, deleted=True)

        stats = get_count_stats(self.user)

        self.assertEqual(stats["num_inferred_faces"], 1)
        self.assertEqual(stats["num_faces"], 1)
