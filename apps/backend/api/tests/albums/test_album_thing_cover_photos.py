"""Regression tests for ``api.models.album_thing.update_default_cover_photo``.

Issue #1849: the helper used to top up ``cover_photos`` from
``instance.photos`` without excluding photos already in ``cover_photos``.
When the DB returned an already-cover photo in its top-N slice, the
subsequent ``.add()`` was a no-op (M2M uniqueness) and the cover ended up
under-populated. The fix excludes existing covers from the candidate slice.
"""

from django.test import TestCase

from api.models.album_thing import AlbumThing, update_default_cover_photo
from api.tests.utils import create_test_photo, create_test_user


class UpdateDefaultCoverPhotoTest(TestCase):
    def _make_thing(self, owner, photos):
        thing = AlbumThing.objects.create(title="x", thing_type="thing", owner=owner)
        thing.photos.add(*photos)
        return thing

    def test_fills_empty_cover_with_up_to_four_photos(self):
        user = create_test_user()
        photos = [create_test_photo(owner=user) for _ in range(6)]
        thing = self._make_thing(user, photos)

        update_default_cover_photo(thing)

        self.assertEqual(thing.cover_photos.count(), 4)
        self.assertTrue(
            set(thing.cover_photos.values_list("pk", flat=True)).issubset(
                {p.pk for p in photos}
            )
        )

    def test_tops_up_when_cover_overlaps_with_photos(self):
        """The bug case: ``cover_photos`` already contains some photos from
        ``photos``. The buggy helper's unfiltered top-N slice could return
        already-cover photos, leaving the cover under-populated. The fix must
        skip past those and pull in the remaining survivors.
        """
        user = create_test_user()
        photos = [create_test_photo(owner=user) for _ in range(4)]
        thing = self._make_thing(user, photos)
        thing.cover_photos.add(photos[0], photos[1])

        update_default_cover_photo(thing)

        self.assertEqual(thing.cover_photos.count(), 4)
        self.assertEqual(
            set(thing.cover_photos.values_list("pk", flat=True)),
            {p.pk for p in photos},
        )

    def test_noop_when_cover_already_full(self):
        user = create_test_user()
        photos = [create_test_photo(owner=user) for _ in range(6)]
        thing = self._make_thing(user, photos)
        # The update_photo_count receiver fires during thing.photos.add(...)
        # and pre-fills cover_photos non-deterministically; use .set() to
        # force a known full state before re-invoking the helper.
        thing.cover_photos.set(photos[:4])

        update_default_cover_photo(thing)

        cover_ids = set(thing.cover_photos.values_list("pk", flat=True))
        self.assertEqual(len(cover_ids), 4)
        self.assertEqual(cover_ids, {p.pk for p in photos[:4]})

    def test_skips_hidden_photos(self):
        """Hidden photos must never become covers, even when the cover is
        empty and they would otherwise satisfy the count.
        """
        user = create_test_user()
        visible = [create_test_photo(owner=user) for _ in range(2)]
        hidden = [create_test_photo(owner=user, hidden=True) for _ in range(2)]
        thing = self._make_thing(user, [*visible, *hidden])

        update_default_cover_photo(thing)

        cover_ids = set(thing.cover_photos.values_list("pk", flat=True))
        self.assertEqual(cover_ids, {p.pk for p in visible})

    def test_stops_at_available_photo_count(self):
        """When fewer than four eligible photos exist the cover takes only
        what is available — no error, no padding."""
        user = create_test_user()
        photos = [create_test_photo(owner=user) for _ in range(2)]
        thing = self._make_thing(user, photos)

        update_default_cover_photo(thing)

        self.assertEqual(thing.cover_photos.count(), 2)
