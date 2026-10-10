"""``POST /api/photosedit/rating/``: an arbitrary 0-5 star rating.

The mobile app's star row used to send ``PATCH /photos/edit/<hash>/`` with
``{rating}``. That endpoint ignores ``rating`` (see
``test_photo_edit_endpoint``), answers 200 and leaves ``last_modified`` alone,
so the phone kept a rating the server never stored and no delta sync ever
corrected it. This endpoint is the bulk favorite's sibling: owner-scoped,
bumps ``last_modified``, and queues the same rating write to disk.
"""

import datetime
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.metadata.jobs import write_photo_ratings
from api.models import Photo, User
from api.tests.test_sync_api import PHOTOS_URL, sync_pull
from api.tests.utils import create_test_photos, create_test_user

URL = "/api/photosedit/rating/"
LONG_AGO = timezone.now() - datetime.timedelta(days=30)


class SetPhotosRatingTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user(favorite_min_rating=4)
        self.user.save_metadata_to_disk = User.SaveMetadata.OFF
        self.user.save()
        self.other = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.photos = create_test_photos(number_of_photos=3, owner=self.user)
        self.hashes = [p.image_hash for p in self.photos]
        Photo.objects.filter(owner=self.user).update(last_modified=LONG_AGO)

    def _rate(self, image_hashes, rating):
        return self.client.post(
            URL, {"image_hashes": image_hashes, "rating": rating}, format="json"
        )

    def test_sets_the_rating_and_bumps_last_modified(self):
        response = self._rate(self.hashes[:2], 3)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "status": True,
                "count": 2,
                "updated_hashes": self.hashes[:2],
                "not_updated_hashes": [],
            },
        )
        rated = Photo.objects.filter(image_hash__in=self.hashes[:2])
        self.assertEqual(set(rated.values_list("rating", flat=True)), {3})
        for photo in rated:
            self.assertGreater(photo.last_modified, LONG_AGO)
        untouched = Photo.objects.get(image_hash=self.hashes[2])
        self.assertEqual(untouched.rating, 0)
        self.assertEqual(untouched.last_modified, LONG_AGO)

    def test_any_rating_from_zero_to_five(self):
        for rating in (5, 1, 4, 0):
            with self.subTest(rating=rating):
                response = self._rate(self.hashes[:1], rating)
                self.assertEqual(response.status_code, 200)
                photo = Photo.objects.get(image_hash=self.hashes[0])
                self.assertEqual(photo.rating, rating)

    def test_an_unchanged_rating_is_reported_and_not_rewritten(self):
        Photo.objects.filter(image_hash=self.hashes[0]).update(rating=2)

        response = self._rate(self.hashes[:2], 2)

        data = response.json()
        self.assertEqual(data["count"], 1)
        self.assertEqual(data["updated_hashes"], [self.hashes[1]])
        self.assertEqual(data["not_updated_hashes"], [self.hashes[0]])
        unchanged = Photo.objects.get(image_hash=self.hashes[0])
        self.assertEqual(unchanged.last_modified, LONG_AGO)

    @patch("api.views.photos.logger.warning", autospec=True)
    def test_other_users_photos_are_left_alone_and_not_echoed(self, warning):
        theirs = create_test_photos(number_of_photos=1, owner=self.other)[0]

        response = self._rate([theirs.image_hash, self.hashes[0]], 5)

        data = response.json()
        self.assertEqual(data["updated_hashes"], [self.hashes[0]])
        # A foreign photo reads as missing, so its existence does not leak.
        self.assertEqual(data["not_updated_hashes"], [])
        theirs.refresh_from_db()
        self.assertEqual(theirs.rating, 0)
        warning.assert_called_once_with(
            f"Could not set photo {theirs.image_hash} to rating. "
            "It does not exist or is not owned by user."
        )

    def test_a_shared_photo_cannot_be_rated_by_the_recipient(self):
        theirs = create_test_photos(number_of_photos=1, owner=self.other)[0]
        theirs.shared_to.add(self.user)

        response = self._rate([theirs.image_hash], 5)

        self.assertEqual(response.json()["count"], 0)
        theirs.refresh_from_db()
        self.assertEqual(theirs.rating, 0)

    def test_the_new_rating_reaches_the_delta_sync_feed(self):
        _, _, cursor = sync_pull(self.client, PHOTOS_URL)

        self._rate(self.hashes[:1], 5)

        items, _, _ = sync_pull(self.client, PHOTOS_URL, cursor=cursor)
        self.assertEqual(
            [(i["id"], i["rating"], i["is_favorite"]) for i in items],
            [(str(self.photos[0].id), 5, True)],
        )

    def test_malformed_bodies_are_refused(self):
        for body in (
            {"image_hashes": self.hashes},
            {"rating": 3},
            {"rating": 3, "image_hashes": self.hashes[0]},
            # true must not read as one star, nor "3" as three.
            {"rating": True, "image_hashes": self.hashes},
            {"rating": "3", "image_hashes": self.hashes},
            {"rating": 3.5, "image_hashes": self.hashes},
            {"rating": None, "image_hashes": self.hashes},
            {"rating": -1, "image_hashes": self.hashes},
            {"rating": 6, "image_hashes": self.hashes},
        ):
            with self.subTest(body=body):
                response = self.client.post(URL, body, format="json")
                self.assertEqual(response.status_code, 400)
        self.assertEqual(
            set(Photo.objects.filter(owner=self.user).values_list("rating", flat=True)),
            {0},
        )

    def test_select_all_is_refused(self):
        response = self.client.post(
            URL, {"select_all": True, "query": {}, "rating": 5}, format="json"
        )

        self.assertEqual(response.status_code, 400)
        fields = [error["field"] for error in response.json()["errors"]]
        self.assertEqual(fields, ["select_all"])
        self.assertFalse(Photo.objects.filter(rating=5).exists())


class SetPhotosRatingMetadataWriteTest(TestCase):
    """The rating reaches the file or sidecar the way a favorite's does."""

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.photos = create_test_photos(number_of_photos=2, owner=self.user)
        self.hashes = [p.image_hash for p in self.photos]

    def _rate(self, mode, rating):
        self.user.save_metadata_to_disk = mode
        self.user.save()
        with patch("api.metadata.jobs.AsyncTask") as async_task:
            response = self.client.post(
                URL, {"image_hashes": self.hashes, "rating": rating}, format="json"
            )
        self.assertEqual(response.status_code, 200)
        return async_task

    def test_sidecar_mode_queues_a_sidecar_write_for_the_changed_photos(self):
        Photo.objects.filter(pk=self.photos[0].pk).update(rating=3)

        async_task = self._rate(User.SaveMetadata.SIDECAR_FILE, 3)

        func, photo_ids, use_sidecar = async_task.call_args.args
        self.assertIs(func, write_photo_ratings)
        self.assertEqual(list(photo_ids), [self.photos[1].pk])
        self.assertTrue(use_sidecar)
        async_task.return_value.run.assert_called_once_with()

    def test_media_file_mode_writes_into_the_file(self):
        async_task = self._rate(User.SaveMetadata.MEDIA_FILE, 2)

        _, photo_ids, use_sidecar = async_task.call_args.args
        self.assertCountEqual(photo_ids, [p.pk for p in self.photos])
        self.assertFalse(use_sidecar)

    def test_nothing_is_queued_when_saving_metadata_is_off(self):
        async_task = self._rate(User.SaveMetadata.OFF, 4)

        async_task.assert_not_called()
        self.assertEqual(Photo.objects.filter(owner=self.user, rating=4).count(), 2)

    def test_nothing_is_queued_when_nothing_changed(self):
        async_task = self._rate(User.SaveMetadata.SIDECAR_FILE, 0)

        async_task.assert_not_called()
