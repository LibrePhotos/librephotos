"""Photos not in an album (#530): ``/api/photos/no-album/`` and its select-all.

The list holds the requester's visible photos that are in none of their own
albums; an album another user shares with them does not count. Select-all on
the page sends ``no_album`` (plus ``show_all_stack_photos``, since the list
shows every member of a stack) to ``build_photo_queryset``, so a bulk action
reaches exactly the photos the list shows.
"""

from datetime import timedelta

from django.contrib.auth.models import AnonymousUser
from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import Photo
from api.photos.selection import build_photo_queryset
from api.tests.utils import (
    create_test_album_user,
    create_test_photo,
    create_test_stack,
    create_test_user,
)

URL = "/api/photos/no-album/"


class NoAlbumListTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.other = create_test_user()
        self.client.force_authenticate(user=self.user)

    def _hashes(self, query: str = "") -> list[str]:
        response = self.client.get(f"{URL}?{query}" if query else URL)
        self.assertEqual(response.status_code, 200, response.content[:300])
        return [row["image_hash"] for row in response.json()["results"]]

    def test_lists_only_photos_in_none_of_the_users_own_albums(self):
        unsorted = create_test_photo(owner=self.user)
        sorted_photo = create_test_photo(owner=self.user)
        create_test_album_user(owner=self.user).photos.add(sorted_photo)

        self.assertEqual(self._hashes(), [unsorted.image_hash])

    def test_an_album_shared_to_the_user_does_not_count(self):
        mine = create_test_photo(owner=self.user)
        shared_album = create_test_album_user(owner=self.other)
        shared_album.photos.add(mine)
        shared_album.shared_to.add(self.user)

        self.assertEqual(self._hashes(), [mine.image_hash])

    def test_an_empty_album_hides_nothing(self):
        photo = create_test_photo(owner=self.user)
        create_test_album_user(owner=self.user)

        self.assertEqual(self._hashes(), [photo.image_hash])

    def test_hidden_trashed_and_other_users_photos_stay_out(self):
        visible = create_test_photo(owner=self.user)
        create_test_photo(owner=self.user, hidden=True)
        create_test_photo(owner=self.user, in_trashcan=True)
        create_test_photo(owner=self.other)
        create_test_photo(owner=self.other, public=True)

        self.assertEqual(self._hashes(), [visible.image_hash])

    def test_newest_first_with_undated_photos_last(self):
        now = timezone.now()
        old = create_test_photo(owner=self.user, exif_timestamp=now - timedelta(days=9))
        undated = create_test_photo(owner=self.user, exif_timestamp=None)
        new = create_test_photo(owner=self.user, exif_timestamp=now)

        self.assertEqual(
            self._hashes(), [new.image_hash, old.image_hash, undated.image_hash]
        )

    def test_pages_carry_the_count(self):
        for _ in range(3):
            create_test_photo(owner=self.user)

        data = self.client.get(f"{URL}?page_size=2").json()

        self.assertEqual(data["count"], 3)
        self.assertEqual(len(data["results"]), 2)
        self.assertIsNotNone(data["next"])

    def test_media_filter_narrows_the_list(self):
        still = create_test_photo(owner=self.user)
        video = create_test_photo(owner=self.user, video=True)
        sorted_video = create_test_photo(owner=self.user, video=True)
        create_test_album_user(owner=self.user).photos.add(sorted_video)

        self.assertEqual(self._hashes("video=true"), [video.image_hash])
        self.assertEqual(self._hashes("video=false"), [still.image_hash])

    def test_saved_timeline_default_is_ignored(self):
        create_test_photo(owner=self.user, video=True)
        create_test_photo(owner=self.user, is_document=True)
        self.user.default_timeline_filter = {"hide_documents": True, "media": "photos"}
        self.user.save(update_fields=["default_timeline_filter"])

        self.assertEqual(len(self._hashes()), 2)
        self.assertEqual(len(self._hashes("apply_default=true")), 2)

    def test_anonymous_callers_are_refused(self):
        create_test_photo(owner=self.user)

        response = APIClient().get(URL)

        self.assertIn(response.status_code, (401, 403))


class NoAlbumSelectAllTest(TestCase):
    """``build_photo_queryset`` with ``no_album`` is the list, photo for photo."""

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.other = create_test_user()
        self.client.force_authenticate(user=self.user)

        self.unsorted = create_test_photo(owner=self.user)
        self.unsorted_video = create_test_photo(owner=self.user, video=True)
        self.sorted = create_test_photo(owner=self.user)
        create_test_album_user(owner=self.user).photos.add(self.sorted)
        self.in_shared_album = create_test_photo(owner=self.user)
        shared_album = create_test_album_user(owner=self.other)
        shared_album.photos.add(self.in_shared_album)
        shared_album.shared_to.add(self.user)
        # A stack member that is not its primary: the list shows it.
        self.stack_member = create_test_photo(owner=self.user)
        stack = create_test_stack(owner=self.user, primary_photo=self.unsorted)
        stack.photos.add(self.unsorted, self.stack_member)
        create_test_photo(owner=self.user, hidden=True)
        create_test_photo(owner=self.other)

    def _listed(self, query: str = "") -> set[str]:
        rows = self.client.get(f"{URL}?{query}").json()["results"]
        return {row["image_hash"] for row in rows}

    def _selected(self, **query: object) -> set[str]:
        params = {"no_album": True, "show_all_stack_photos": True, **query}
        photos = build_photo_queryset(self.user, params)
        return set(photos.values_list("image_hash", flat=True))

    def test_select_all_matches_the_list(self):
        expected = {
            self.unsorted.image_hash,
            self.unsorted_video.image_hash,
            self.in_shared_album.image_hash,
            self.stack_member.image_hash,
        }
        self.assertEqual(self._listed(), expected)
        self.assertEqual(self._selected(), expected)

    def test_select_all_matches_the_media_filtered_list(self):
        self.assertEqual(self._selected(video=True), self._listed("video=true"))
        self.assertEqual(self._selected(video=True), {self.unsorted_video.image_hash})

    def test_no_album_false_does_not_narrow(self):
        everything = build_photo_queryset(
            self.user, {"no_album": False, "show_all_stack_photos": True}
        )
        self.assertIn(self.sorted, everything)

    def test_anonymous_selects_nothing(self):
        self.assertFalse(build_photo_queryset(AnonymousUser(), {"no_album": True}))

    def test_bulk_favorite_reaches_only_the_unsorted_photos(self):
        payload = {
            "select_all": True,
            "query": {"no_album": True, "show_all_stack_photos": True},
            "favorite": True,
        }

        response = self.client.post(
            "/api/photosedit/favorite/", format="json", data=payload
        )

        self.assertEqual(response.status_code, 200, response.content[:300])
        favorites = set(
            Photo.objects.filter(rating__gte=self.user.favorite_min_rating).values_list(
                "image_hash", flat=True
            )
        )
        self.assertEqual(favorites, self._listed())
        self.assertNotIn(self.sorted.image_hash, favorites)
