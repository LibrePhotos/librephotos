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

from datetime import timedelta
from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.metadata.jobs import write_photo_ratings
from api.metadata.tags import Tags
from api.models import Photo, User
from api.models.photo import trash_photos
from api.photos.selection import build_photo_queryset
from api.serializers.photos import (
    PhotoSummarySerializer,
    with_photo_summary_relations,
)
from api.tests.utils import (
    create_test_duplicate,
    create_test_photos,
    create_test_stack,
    create_test_user,
)

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
                    patch("api.search.similarity.requests.post") as post,
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
        with patch("api.metadata.jobs.enqueue_task") as async_task:
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
        with patch("api.metadata.jobs.enqueue_task", side_effect=RuntimeError("down")):
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
        with patch("api.metadata.photo_writer.write_metadata") as write:
            write_photo_ratings([p.pk for p in self.photos], True)

        self.assertEqual(write.call_count, 2)
        for call in write.call_args_list:
            path, tags = call.args
            self.assertEqual(tags, {Tags.RATING: 4})
            self.assertTrue(call.kwargs["use_sidecar"])

    def test_one_failing_photo_does_not_stop_the_rest(self):
        with patch(
            "api.metadata.photo_writer.write_metadata",
            side_effect=[OSError("locked"), None],
        ) as write:
            write_photo_ratings([p.pk for p in self.photos], False)
        self.assertEqual(write.call_count, 2)


class BulkMutationMalformedBodyTest(TestCase):
    """A malformed body is a 400, not a KeyError/TypeError 500."""

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    def test_missing_or_mistyped_fields(self):
        for url, field in ENDPOINTS:
            for body in (
                {field: True},
                {"image_hashes": ["abc"]},
                {field: True, "image_hashes": "abc"},
                {field: True, "select_all": True, "query": ["x"]},
                # Strings are not read by truthiness: "false" would trash.
                {field: "false", "image_hashes": ["abc"]},
                {field: 1, "image_hashes": ["abc"]},
                {field: True, "select_all": "false", "image_hashes": ["abc"]},
            ):
                with self.subTest(url=url, body=body):
                    response = self.client.post(url, body, format="json")
                    self.assertEqual(response.status_code, 400)

    def test_string_false_never_trashes(self):
        photo = create_test_photos(number_of_photos=1, owner=self.user)[0]
        response = self.client.post(
            "/api/photosedit/setdeleted/",
            {"image_hashes": [photo.image_hash], "deleted": "false"},
            format="json",
        )
        self.assertEqual(response.status_code, 400)
        photo.refresh_from_db()
        self.assertFalse(photo.in_trashcan)


class NoTimestampSelectAllTest(TestCase):
    """Select all on "Photos without Timestamps" acts on every undated photo (#2227).

    The page loads 100 photos at a time, so its select-all has to name the set
    with a query, and that query must match exactly what the list shows on all
    of its pages: undated photos, stacked ones included.
    """

    QUERY = {"no_timestamp": True, "show_all_stack_photos": True}

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user(favorite_min_rating=1)
        self.client.force_authenticate(user=self.user)
        self.undated = create_test_photos(number_of_photos=5, owner=self.user, rating=0)
        self.dated = create_test_photos(
            number_of_photos=2, owner=self.user, exif_timestamp=timezone.now(), rating=0
        )
        # A stack of two undated photos: the list shows both, not only the primary.
        stack = create_test_stack(self.user, primary_photo=self.undated[0])
        stack.photos.add(self.undated[0], self.undated[1])

    def _listed_ids(self, filters=""):
        ids = []
        url = f"/api/photos/notimestamp/?page_size=2{filters}"
        while url:
            page = self.client.get(url).json()
            ids += [row["id"] for row in page["results"]]
            url = page["next"]
        return ids

    def test_query_matches_every_page_of_the_list(self):
        listed = self._listed_ids()
        self.assertEqual(len(listed), 5)

        selected = build_photo_queryset(self.user, self.QUERY)
        self.assertCountEqual([str(p.id) for p in selected], listed)

    def test_query_with_the_media_filter_matches_the_filtered_list(self):
        videos = create_test_photos(number_of_photos=2, owner=self.user, video=True)
        listed = self._listed_ids("&video=true")
        self.assertCountEqual(listed, [str(p.id) for p in videos])

        selected = build_photo_queryset(self.user, {**self.QUERY, "video": True})
        self.assertCountEqual([str(p.id) for p in selected], listed)

    def test_select_all_favorites_every_undated_photo_and_no_dated_one(self):
        with patch("api.metadata.jobs.enqueue_task"):
            response = self.client.post(
                "/api/photosedit/favorite/",
                {"select_all": True, "query": self.QUERY, "favorite": True},
                format="json",
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["count"], 5)
        for photo in self.undated:
            photo.refresh_from_db()
            self.assertEqual(photo.rating, 1)
        for photo in self.dated:
            photo.refresh_from_db()
            self.assertEqual(photo.rating, 0)

    def test_a_false_flag_does_not_narrow(self):
        for value in (False, "false", "0"):
            with self.subTest(value=value):
                selected = build_photo_queryset(
                    self.user, {"no_timestamp": value, "show_all_stack_photos": True}
                )
                self.assertEqual(selected.count(), 7)


class TrashedAtTest(TestCase):
    """Every path that sets ``in_trashcan`` sets ``trashed_at`` with it (#2203)."""

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.photos = create_test_photos(number_of_photos=2, owner=self.user)
        self.hashes = [p.image_hash for p in self.photos]

    def set_deleted(self, body):
        response = self.client.post("/api/photosedit/setdeleted/", body, format="json")
        self.assertEqual(response.status_code, 200, response.content)

    def trashed_at(self):
        return [Photo.objects.get(pk=photo.pk).trashed_at for photo in self.photos]

    def test_trashing_by_hash_stamps_the_time_and_restoring_clears_it(self):
        before = timezone.now()
        self.set_deleted({"image_hashes": self.hashes, "deleted": True})
        for trashed_at in self.trashed_at():
            self.assertIsNotNone(trashed_at)
            self.assertGreaterEqual(trashed_at, before)

        self.set_deleted({"image_hashes": self.hashes, "deleted": False})
        self.assertEqual(self.trashed_at(), [None, None])

    def test_select_all_trashes_and_restores_with_the_date(self):
        self.set_deleted({"select_all": True, "query": {}, "deleted": True})
        self.assertNotIn(None, self.trashed_at())

        self.set_deleted(
            {"select_all": True, "query": {"in_trashcan": True}, "deleted": False}
        )
        self.assertEqual(self.trashed_at(), [None, None])

    def test_trashing_again_keeps_the_first_date(self):
        long_ago = timezone.now() - timedelta(days=40)
        Photo.objects.filter(pk=self.photos[0].pk).update(
            in_trashcan=True, trashed_at=long_ago
        )

        trash_photos(Photo.objects.filter(pk__in=[p.pk for p in self.photos]))

        first, second = self.trashed_at()
        self.assertEqual(first, long_ago)
        self.assertIsNotNone(second)

    def test_resolving_a_duplicate_stamps_the_trashed_photos(self):
        kept, other = self.photos
        duplicate = create_test_duplicate(owner=self.user)
        duplicate.photos.add(kept, other)

        duplicate.resolve(kept)

        self.assertEqual(duplicate.trashed_count, 1)
        kept_at, other_at = self.trashed_at()
        self.assertIsNone(kept_at)
        self.assertIsNotNone(other_at)

        duplicate.revert()

        self.assertEqual(self.trashed_at(), [None, None])
        self.assertFalse(Photo.objects.get(pk=other.pk).in_trashcan)

    def test_the_photo_summary_carries_trashed_at(self):
        self.set_deleted({"image_hashes": self.hashes[:1], "deleted": True})

        rows = PhotoSummarySerializer(
            with_photo_summary_relations(
                Photo.objects.filter(pk__in=[p.pk for p in self.photos])
            ),
            many=True,
        ).data

        by_hash = {row["image_hash"]: row["trashed_at"] for row in rows}
        self.assertIsNotNone(by_hash[self.hashes[0]])
        self.assertIsNone(by_hash[self.hashes[1]])
