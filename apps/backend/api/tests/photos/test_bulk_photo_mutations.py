"""The bulk flag endpoints: favorite, hide, make public, move to trash.

They used to answer with a full ``PhotoSerializer`` payload per photo, and
``PhotoSerializer.similar_photos`` calls the similarity sidecar over HTTP, so
favoriting 500 photos made 500 sidecar calls inside the request (and one
sidecar error failed the whole operation). No client reads those payloads:
the web and legacy mobile hooks only read ``count``, mobile-v2 re-reads rows
through its delta sync. The response is now the changed hashes and a count.

A bulk favorite also used to skip the XMP/EXIF rating write that a single
edit gets from ``Photo.save()``; it now queues that write as a job.
"""

from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.metadata.jobs import write_photo_ratings
from api.metadata.tags import Tags
from api.models import Photo, User
from api.tests.utils import create_test_photos, create_test_user

ENDPOINTS = (
    ("/api/photosedit/favorite/", "favorite"),
    ("/api/photosedit/hide/", "hidden"),
    ("/api/photosedit/makepublic/", "val_public"),
    ("/api/photosedit/setdeleted/", "deleted"),
)


class BulkMutationSidecarTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user(favorite_min_rating=1)
        self.client.force_authenticate(user=self.user)
        self.photos = create_test_photos(number_of_photos=5, owner=self.user)
        self.hashes = [p.image_hash for p in self.photos]

    def test_bulk_mutations_never_call_the_similarity_sidecar(self):
        for url, field in ENDPOINTS:
            with self.subTest(url=url):
                with (
                    patch("api.serializers.photos.search_similar_image") as similar,
                    patch("api.image_similarity.requests.post") as post,
                ):
                    response = self.client.post(
                        url,
                        {"image_hashes": self.hashes, field: True},
                        format="json",
                    )
                self.assertEqual(response.status_code, 200)
                similar.assert_not_called()
                post.assert_not_called()

    def test_response_lists_changed_and_unchanged_hashes(self):
        Photo.objects.filter(pk=self.photos[0].pk).update(rating=3)
        response = self.client.post(
            "/api/photosedit/favorite/",
            {"image_hashes": self.hashes + ["missing"], "favorite": True},
            format="json",
        )
        data = response.json()
        self.assertTrue(data["status"])
        self.assertEqual(data["count"], 4)
        self.assertCountEqual(data["updated_hashes"], self.hashes[1:])
        self.assertEqual(data["not_updated_hashes"], [self.hashes[0]])
        # The heavy per-photo payloads are gone: the web client's zod schema
        # would reject slim objects under these keys, so they are not sent.
        for key in ("results", "updated", "not_updated"):
            self.assertNotIn(key, data)

    def test_select_all_response_is_unchanged(self):
        response = self.client.post(
            "/api/photosedit/hide/",
            {"select_all": True, "query": {}, "hidden": True},
            format="json",
        )
        self.assertEqual(response.json(), {"status": True, "count": 5})


class BulkFavoriteMetadataWriteTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user(favorite_min_rating=1)
        self.client.force_authenticate(user=self.user)
        self.photos = create_test_photos(number_of_photos=3, owner=self.user)
        self.hashes = [p.image_hash for p in self.photos]

    def _favorite(self, **payload):
        with patch("api.metadata.jobs.AsyncTask") as async_task:
            response = self.client.post(
                "/api/photosedit/favorite/", payload, format="json"
            )
        self.assertEqual(response.status_code, 200)
        return async_task

    def _set_mode(self, mode):
        self.user.save_metadata_to_disk = mode
        self.user.save()

    def test_queues_a_sidecar_write_for_the_changed_photos(self):
        self._set_mode(User.SaveMetadata.SIDECAR_FILE)
        Photo.objects.filter(pk=self.photos[0].pk).update(rating=5)

        async_task = self._favorite(image_hashes=self.hashes, favorite=True)

        async_task.assert_called_once()
        func, photo_ids, use_sidecar = async_task.call_args.args
        self.assertIs(func, write_photo_ratings)
        self.assertCountEqual(photo_ids, [self.photos[1].pk, self.photos[2].pk])
        self.assertTrue(use_sidecar)
        async_task.return_value.run.assert_called_once_with()

    def test_media_file_mode_writes_into_the_file(self):
        self._set_mode(User.SaveMetadata.MEDIA_FILE)
        async_task = self._favorite(image_hashes=self.hashes, favorite=False)
        # Nothing was a favorite, so nothing changed and nothing is written.
        async_task.assert_not_called()

        Photo.objects.filter(pk=self.photos[0].pk).update(rating=4)
        async_task = self._favorite(image_hashes=self.hashes, favorite=False)
        func, photo_ids, use_sidecar = async_task.call_args.args
        self.assertEqual(list(photo_ids), [self.photos[0].pk])
        self.assertFalse(use_sidecar)

    def test_select_all_queues_the_write_too(self):
        self._set_mode(User.SaveMetadata.SIDECAR_FILE)
        async_task = self._favorite(select_all=True, query={}, favorite=True)
        _, photo_ids, _ = async_task.call_args.args
        self.assertCountEqual(photo_ids, [p.pk for p in self.photos])
        self.assertEqual(
            set(Photo.objects.filter(owner=self.user).values_list("rating", flat=True)),
            {1},
        )

    def test_nothing_is_queued_when_saving_metadata_is_off(self):
        self._set_mode(User.SaveMetadata.OFF)
        async_task = self._favorite(image_hashes=self.hashes, favorite=True)
        async_task.assert_not_called()
        self.assertEqual(Photo.objects.filter(owner=self.user, rating=1).count(), 3)

    def test_a_queue_failure_does_not_fail_the_favorite(self):
        self._set_mode(User.SaveMetadata.SIDECAR_FILE)
        with patch("api.metadata.jobs.AsyncTask", side_effect=RuntimeError("down")):
            response = self.client.post(
                "/api/photosedit/favorite/",
                {"image_hashes": self.hashes, "favorite": True},
                format="json",
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 3)


class WritePhotoRatingsJobTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photos = create_test_photos(number_of_photos=2, owner=self.user)
        Photo.objects.filter(pk__in=[p.pk for p in self.photos]).update(rating=4)

    def test_writes_the_current_rating_like_save_does(self):
        with patch("api.models.photo.write_metadata") as write:
            write_photo_ratings([p.pk for p in self.photos], True)

        self.assertEqual(write.call_count, 2)
        for call in write.call_args_list:
            path, tags = call.args
            self.assertEqual(tags, {Tags.RATING: 4})
            self.assertTrue(call.kwargs["use_sidecar"])

    def test_one_failing_photo_does_not_stop_the_rest(self):
        with patch(
            "api.models.photo.write_metadata", side_effect=[OSError("locked"), None]
        ) as write:
            write_photo_ratings([p.pk for p in self.photos], False)
        self.assertEqual(write.call_count, 2)
