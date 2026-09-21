"""Tests for the ``num_missing_photos`` count in ``api.stats.get_count_stats``.

The filter had the same Q-operator precedence bug that was fixed in
``api.autoalbum.delete_missing_photos``: ``&`` binds tighter than ``|``, so
``Q(owner=user) & Q(files=None) | Q(main_file=None)`` parses as
``(owner AND files) OR main_file`` and the second clause is not scoped to the
requesting user. See ``test_delete_missing_photos.py`` for the sibling guard.
"""

from django.test import TestCase

from api.stats import get_count_stats
from api.tests.utils import create_test_photo, create_test_user


class CountStatsMissingPhotosTest(TestCase):
    def test_does_not_count_other_users_missing_photos(self):
        """Cross-user leak guard.

        With the unparenthesised filter the ``Q(main_file=None)`` clause has no
        owner restriction, so another user's photo with ``main_file=None``
        inflates this user's ``num_missing_photos``.
        """
        user1 = create_test_user()
        user2 = create_test_user()

        # user1 has exactly one missing photo (owner matches, M2M empty).
        create_test_photo(owner=user1)

        # user2's photo must not be counted for user1. Populate the M2M so
        # Q(files=None) does not match, isolating the main_file=None branch.
        photo2 = create_test_photo(owner=user2)
        photo2.files.add(photo2.main_file)
        photo2.main_file = None
        photo2.save()

        stats = get_count_stats(user1)

        self.assertEqual(stats["num_missing_photos"], 1)

    def test_counts_own_photo_missing_only_main_file(self):
        """The OR branch must still apply within the owner's own library."""
        user = create_test_user()

        photo = create_test_photo(owner=user)
        photo.files.add(photo.main_file)
        photo.main_file = None
        photo.save()

        stats = get_count_stats(user)

        self.assertEqual(stats["num_missing_photos"], 1)

    def test_photo_with_files_and_main_file_is_not_missing(self):
        """A fully intact photo is not counted as missing."""
        user = create_test_user()

        photo = create_test_photo(owner=user)
        photo.files.add(photo.main_file)

        stats = get_count_stats(user)

        self.assertEqual(stats["num_missing_photos"], 0)
