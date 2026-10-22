"""``POST /api/photosedit/datetime/``: shift or set the date of many photos
(#2278), and ``POST /api/photos/date-summary/``, its dialog's preview."""

import datetime
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.metadata import edits
from api.metadata.jobs import write_photo_fields
from api.models import Photo, User
from api.models.album_date import AlbumDate
from api.models.photo_metadata import MetadataEdit
from api.tests.utils import create_test_photo, create_test_user

URL = "/api/photosedit/datetime/"
SUMMARY_URL = "/api/photos/date-summary/"
UTC = datetime.UTC


def at(hour, minute=0, second=0, day=9):
    return datetime.datetime(2025, 10, day, hour, minute, second, tzinfo=UTC)


class BulkDateTimeTestCase(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user(save_metadata_to_disk=User.SaveMetadata.OFF)
        self.other = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.trip = [
            self._photo(at(8, 14, 2)),
            self._photo(at(12, 30)),
            self._photo(at(19, 40, 55, day=11)),
        ]
        self.undated = self._photo(None)

    def _photo(self, when, owner=None):
        return create_test_photo(
            owner=owner or self.user, exif_timestamp=when, timestamp=None
        )

    def _post(self, photos, **body):
        return self.client.post(
            URL,
            {"image_hashes": [p.image_hash for p in photos], **body},
            format="json",
        )

    def _dates(self, photos):
        return [Photo.objects.get(pk=p.pk).exif_timestamp for p in photos]


class ShiftTest(BulkDateTimeTestCase):
    def test_an_hour_earlier_keeps_order_and_spacing(self):
        before = self._dates(self.trip)

        response = self._post(self.trip, mode="shift", seconds=-3600)

        self.assertEqual(200, response.status_code, response.content)
        self.assertEqual({"count": 3, "skipped_without_date": 0}, response.json())
        hour = datetime.timedelta(hours=1)
        self.assertEqual([d - hour for d in before], self._dates(self.trip))
        for photo in Photo.objects.filter(pk__in=[p.pk for p in self.trip]):
            # The new date is the user's: it overrides the date rules.
            self.assertEqual(photo.exif_timestamp, photo.timestamp)

    def test_a_photo_without_a_date_is_skipped_and_counted(self):
        response = self._post([*self.trip, self.undated], mode="shift", seconds=90)

        self.assertEqual({"count": 3, "skipped_without_date": 1}, response.json())
        undated = Photo.objects.get(pk=self.undated.pk)
        self.assertIsNone(undated.exif_timestamp)
        self.assertIsNone(undated.timestamp)

    def test_each_changed_photo_gets_one_edit_in_the_history(self):
        self._post(self.trip, mode="shift", seconds=-3600)

        edits_made = MetadataEdit.objects.filter(field_name=edits.DATE_TAKEN)
        self.assertEqual(3, edits_made.count())
        first = edits_made.get(photo_id=self.trip[0].pk)
        self.assertEqual("2025-10-09T08:14:02Z", first.old_value)
        self.assertEqual("2025-10-09T07:14:02Z", first.new_value)
        self.assertEqual(self.user, first.user)

    def test_the_photo_moves_to_its_new_day_album(self):
        self._post(self.trip[:1], mode="shift", seconds=-9 * 3600)

        photo = Photo.objects.get(pk=self.trip[0].pk)
        self.assertEqual(at(23, 14, 2, day=8), photo.exif_timestamp)
        day = AlbumDate.objects.get(owner=self.user, date=datetime.date(2025, 10, 8))
        self.assertTrue(day.photos.filter(pk=photo.pk).exists())

    def test_a_hand_set_date_wins_over_any_rule_list(self):
        # #2254: the "Timestamp set by user" rule is gone (migration 0167); a
        # date set by hand applies whatever the owner's rules say.
        self.user.datetime_rules = "[]"
        self.user.save()

        self._post(self.trip[:1], mode="shift", seconds=60)

        self.assertEqual([at(8, 15, 2)], self._dates(self.trip[:1]))

    def test_another_users_photo_is_not_touched(self):
        theirs = self._photo(at(10), owner=self.other)

        response = self._post([theirs, self.trip[0]], mode="shift", seconds=60)

        self.assertEqual({"count": 1, "skipped_without_date": 0}, response.json())
        self.assertEqual([at(10)], self._dates([theirs]))
        self.assertFalse(MetadataEdit.objects.filter(photo_id=theirs.pk).exists())

    def test_a_zero_or_missing_shift_is_refused(self):
        for body in ({"seconds": 0}, {}, {"seconds": "60"}, {"seconds": 1.5}):
            with self.subTest(body=body):
                response = self._post(self.trip, mode="shift", **body)
                self.assertEqual(400, response.status_code)
                self.assertEqual("seconds", response.json()["errors"][0]["field"])
        self.assertEqual([at(8, 14, 2)], self._dates(self.trip[:1]))

    def test_a_shift_beyond_a_century_is_refused(self):
        response = self._post(self.trip, mode="shift", seconds=10**10)

        self.assertEqual(400, response.status_code)

    def test_an_unknown_mode_is_refused(self):
        response = self._post(self.trip, mode="scale", seconds=60)

        self.assertEqual(400, response.status_code)
        self.assertEqual("mode", response.json()["errors"][0]["field"])


class SetTest(BulkDateTimeTestCase):
    def test_every_photo_gets_the_same_date_undated_ones_too(self):
        response = self._post(
            [*self.trip, self.undated], mode="set", datetime="2025-10-11T10:18:00"
        )

        self.assertEqual({"count": 4, "skipped_without_date": 0}, response.json())
        self.assertEqual(
            [at(10, 18, day=11)] * 4, self._dates([*self.trip, self.undated])
        )

    def test_set_needs_a_datetime(self):
        for body in ({}, {"datetime": None}, {"datetime": "yesterday"}):
            with self.subTest(body=body):
                response = self._post(self.trip, mode="set", **body)
                self.assertEqual(400, response.status_code)
                self.assertEqual("datetime", response.json()["errors"][0]["field"])

    def test_the_same_date_again_records_no_edit(self):
        self._post(self.trip[:1], mode="set", datetime="2025-10-11T10:18:00")
        MetadataEdit.objects.all().delete()

        response = self._post(self.trip[:1], mode="set", datetime="2025-10-11T10:18:00")

        self.assertEqual(1, response.json()["count"])
        self.assertFalse(MetadataEdit.objects.exists())


class SelectAllTest(BulkDateTimeTestCase):
    def test_the_query_and_the_excluded_hashes_decide(self):
        hidden = self._photo(at(9))
        Photo.objects.filter(pk=hidden.pk).update(hidden=True)
        theirs = self._photo(at(9), owner=self.other)

        response = self.client.post(
            URL,
            {
                "select_all": True,
                "query": {},
                "excluded_hashes": [self.trip[2].image_hash],
                "mode": "shift",
                "seconds": 3600,
            },
            format="json",
        )

        self.assertEqual({"count": 2, "skipped_without_date": 1}, response.json())
        self.assertEqual(
            [at(9, 14, 2), at(13, 30), at(19, 40, 55, day=11), at(9), at(9)],
            self._dates([*self.trip, hidden, theirs]),
        )

    def test_batches_change_every_photo_and_queue_one_write(self):
        self.user.save_metadata_to_disk = User.SaveMetadata.SIDECAR_FILE
        self.user.save()

        with (
            patch.object(edits, "CAPTURE_TIME_BATCH_SIZE", 2),
            patch("api.metadata.jobs.enqueue_task") as enqueue,
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = self.client.post(
                URL,
                {"select_all": True, "query": {}, "mode": "shift", "seconds": 60},
                format="json",
            )

        self.assertEqual({"count": 3, "skipped_without_date": 1}, response.json())
        enqueue.assert_called_once()
        func, ids, field, use_sidecar = enqueue.call_args.args
        self.assertIs(write_photo_fields, func)
        self.assertEqual({p.pk for p in self.trip}, set(ids))
        self.assertEqual((edits.DATE_TAKEN, True), (field, use_sidecar))


class FailedBatchTest(BulkDateTimeTestCase):
    def test_the_batches_before_a_failure_are_still_written(self):
        self.user.save_metadata_to_disk = User.SaveMetadata.SIDECAR_FILE
        self.user.save()
        calls = []

        def compute(photo):
            calls.append(photo.pk)
            if len(calls) == 2:
                raise RuntimeError("the second batch fails")
            return at(1)

        with (
            patch.object(edits, "CAPTURE_TIME_BATCH_SIZE", 1),
            patch("api.metadata.jobs.enqueue_task") as enqueue,
            self.captureOnCommitCallbacks(execute=True),
            self.assertRaises(RuntimeError),
        ):
            edits.set_capture_times(
                Photo.objects.filter(pk__in=[p.pk for p in self.trip]),
                compute,
                self.user,
            )

        self.assertEqual([calls[0]], enqueue.call_args.args[1])
        self.assertEqual(at(1), Photo.objects.get(pk=calls[0]).exif_timestamp)
        self.assertNotEqual(at(1), Photo.objects.get(pk=calls[1]).exif_timestamp)


class WriteBackQueueTest(BulkDateTimeTestCase):
    def _shift_with(self, mode):
        self.user.save_metadata_to_disk = mode
        self.user.save()
        with (
            patch("api.metadata.jobs.enqueue_task") as enqueue,
            self.captureOnCommitCallbacks(execute=True),
        ):
            self._post([*self.trip, self.undated], mode="shift", seconds=-3600)
        return enqueue

    def test_one_job_writes_the_changed_photos_when_sync_is_on(self):
        enqueue = self._shift_with(User.SaveMetadata.MEDIA_FILE)

        enqueue.assert_called_once()
        func, ids, field, use_sidecar = enqueue.call_args.args
        self.assertIs(write_photo_fields, func)
        self.assertEqual([p.pk for p in self.trip], sorted(ids, key=self._order))
        self.assertEqual((edits.DATE_TAKEN, False), (field, use_sidecar))

    def _order(self, photo_id):
        return [p.pk for p in self.trip].index(photo_id)

    def test_nothing_is_queued_when_sync_is_off(self):
        enqueue = self._shift_with(User.SaveMetadata.OFF)

        enqueue.assert_not_called()

    def test_an_unchanged_user_date_is_not_written_again(self):
        self.user.save_metadata_to_disk = User.SaveMetadata.SIDECAR_FILE
        self.user.save()
        Photo.objects.filter(pk=self.trip[0].pk).update(timestamp=at(10, 18, day=11))

        with (
            patch("api.metadata.jobs.enqueue_task") as enqueue,
            self.captureOnCommitCallbacks(execute=True),
        ):
            self._post(self.trip[:2], mode="set", datetime="2025-10-11T10:18:00")

        self.assertEqual([self.trip[1].pk], enqueue.call_args.args[1])


class DateSummaryTest(BulkDateTimeTestCase):
    def _summary(self, body):
        response = self.client.post(SUMMARY_URL, body, format="json")
        self.assertEqual(200, response.status_code, response.content)
        return response.json()

    def test_counts_and_the_oldest_and_newest_dated_photo(self):
        summary = self._summary(
            {"image_hashes": [p.image_hash for p in [*self.trip, self.undated]]}
        )

        self.assertEqual(
            {
                "count": 4,
                "without_date": 1,
                "oldest": {
                    "image_hash": self.trip[0].image_hash,
                    "exif_timestamp": "2025-10-09T08:14:02Z",
                },
                "newest": {
                    "image_hash": self.trip[2].image_hash,
                    "exif_timestamp": "2025-10-11T19:40:55Z",
                },
            },
            summary,
        )

    def test_without_a_dated_photo_both_ends_are_null(self):
        summary = self._summary({"image_hashes": [self.undated.image_hash]})

        self.assertEqual(
            {"count": 1, "without_date": 1, "oldest": None, "newest": None}, summary
        )

    def test_select_all_counts_only_the_requesters_photos(self):
        self._photo(at(1), owner=self.other)

        summary = self._summary(
            {
                "select_all": True,
                "query": {},
                "excluded_hashes": [self.trip[0].image_hash],
            }
        )

        self.assertEqual(3, summary["count"])
        self.assertEqual(self.trip[1].image_hash, summary["oldest"]["image_hash"])

    def test_it_changes_nothing(self):
        before = self._dates(self.trip)

        self._summary({"image_hashes": [p.image_hash for p in self.trip]})

        self.assertEqual(before, self._dates(self.trip))
        self.assertFalse(MetadataEdit.objects.exists())
