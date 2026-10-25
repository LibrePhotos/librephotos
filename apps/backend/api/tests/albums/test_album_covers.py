"""``api.albums.covers.attach_cover_photos``: a few visible photos per card.

It replaced a sliced ``Prefetch`` whose ``ROW_NUMBER()`` ranked every photo
of every listed album, a join that ran Postgres out of shared memory on a
large library (#2868).
"""

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from api.albums.covers import COVER_PHOTO_COUNT, attach_cover_photos
from api.tests.utils import (
    create_test_album_place,
    create_test_album_thing,
    create_test_photo,
    create_test_tag,
    create_test_user,
)


class AttachCoverPhotosTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def _covers(self, album):
        attach_cover_photos([album], "covers")
        return album.covers

    def test_at_most_four_covers(self):
        album = create_test_album_thing(self.user)
        album.photos.add(*[create_test_photo(owner=self.user) for _ in range(6)])

        covers = self._covers(album)

        self.assertEqual(len(covers), COVER_PHOTO_COUNT)
        self.assertTrue(
            {p.pk for p in covers} <= set(album.photos.values_list("pk", flat=True))
        )

    def test_only_visible_photos_cover_an_album(self):
        visible = create_test_photo(owner=self.user)
        album = create_test_album_place(self.user)
        album.photos.add(
            visible,
            create_test_photo(owner=self.user, hidden=True),
            create_test_photo(owner=self.user, in_trashcan=True),
            create_test_photo(owner=self.user, removed=True),
            # No thumbnail yet.
            create_test_photo(owner=self.user, aspect_ratio=None),
        )

        self.assertEqual([p.pk for p in self._covers(album)], [visible.pk])

    def test_hidden_photos_do_not_use_up_the_slots(self):
        album = create_test_album_thing(self.user)
        album.photos.add(
            *[create_test_photo(owner=self.user, hidden=True) for _ in range(5)]
        )
        visible = [create_test_photo(owner=self.user) for _ in range(2)]
        album.photos.add(*visible)

        self.assertEqual({p.pk for p in self._covers(album)}, {p.pk for p in visible})

    def test_an_empty_album_has_no_covers(self):
        album = create_test_album_thing(self.user)

        self.assertEqual(self._covers(album), [])

    def test_covers_load_only_hash_and_video(self):
        album = create_test_album_thing(self.user)
        photo = create_test_photo(owner=self.user, video=True)
        album.photos.add(photo)

        (cover,) = self._covers(album)

        self.assertEqual((cover.image_hash, cover.video), (photo.image_hash, True))
        self.assertEqual(cover.get_deferred_fields() & {"image_hash", "video"}, set())

    def test_two_queries_whatever_the_number_of_albums(self):
        albums = []
        for _ in range(5):
            album = create_test_tag(self.user)
            album.photos.add(create_test_photo(owner=self.user))
            albums.append(album)

        with self.assertNumQueries(2):
            attach_cover_photos(albums, "cover_photos")

        for album in albums:
            self.assertEqual(
                [p.pk for p in album.cover_photos],
                list(album.photos.values_list("pk", flat=True)),
            )

    def test_no_albums_no_query(self):
        with self.assertNumQueries(0):
            attach_cover_photos([], "cover_photos")

    def test_no_row_number_over_the_album_photos(self):
        """The cover lookup is per album, not a ranking of every album photo."""
        album = create_test_album_thing(self.user)
        album.photos.add(create_test_photo(owner=self.user))

        with CaptureQueriesContext(connection) as queries:
            attach_cover_photos([album], "covers")

        self.assertFalse(
            any("ROW_NUMBER" in q["sql"].upper() for q in queries.captured_queries)
        )
