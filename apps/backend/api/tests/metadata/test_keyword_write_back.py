"""Tag edits written as file keywords (#2289): the queue, the job and the rules.

The files themselves are written and read back with real ExifTool in
``test_write_back_round_trip.KeywordRoundTripTest``.
"""

from unittest.mock import patch

from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from api.metadata import edits
from api.metadata.jobs import queue_keyword_write, write_photo_keywords
from api.metadata.photo_writer import keyword_changes, seeded_keywords
from api.metadata.reader import MetadataReadError
from api.metadata.tags import Tags
from api.models import User
from api.models.photo_metadata import PhotoMetadata, keywords_to_import
from api.tests.utils import create_test_photo, create_test_tag, create_test_user

SUBJECT_ADD = f"{Tags.SUBJECT}+"
SUBJECT_REMOVE = f"{Tags.SUBJECT}-"


class KeywordChangesTest(SimpleTestCase):
    def test_adds_a_missing_name_once(self):
        self.assertEqual(
            {SUBJECT_REMOVE: ["Sunset"], SUBJECT_ADD: ["Sunset"]},
            keyword_changes(Tags.SUBJECT, ["Holiday"], None, ["Sunset"], []),
        )

    def test_removes_a_present_name(self):
        self.assertEqual(
            {SUBJECT_REMOVE: ["Holiday"]},
            keyword_changes(Tags.SUBJECT, ["Holiday"], None, [], ["Holiday"]),
        )

    def test_a_list_that_already_agrees_needs_no_write(self):
        self.assertEqual(
            {}, keyword_changes(Tags.SUBJECT, ["Holiday"], None, ["Holiday"], ["Gone"])
        )

    def test_a_name_missing_from_the_iptc_copy_is_added(self):
        changes = keyword_changes(
            Tags.KEYWORDS_MWG, ["Holiday"], ["Beach"], ["Holiday"], []
        )
        self.assertEqual(["Holiday"], changes[f"{Tags.KEYWORDS_MWG}+"])

    def test_a_name_only_in_the_iptc_copy_is_removed(self):
        changes = keyword_changes(Tags.KEYWORDS_MWG, [], ["Beach"], [], ["Beach"])
        self.assertEqual({f"{Tags.KEYWORDS_MWG}-": ["Beach"]}, changes)


class SeededKeywordsTest(SimpleTestCase):
    def test_starts_from_the_photo_keywords(self):
        self.assertEqual(
            ["Holiday", "Sunset"],
            seeded_keywords(["Beach", "Holiday"], ["Sunset"], ["Beach"]),
        )

    def test_nothing_when_the_list_would_not_change(self):
        self.assertIsNone(seeded_keywords(["Holiday"], ["Holiday"], ["Gone"]))

    def test_an_emptied_list_is_empty(self):
        self.assertEqual([], seeded_keywords(["Holiday"], [], ["Holiday"]))


class KeywordsToImportTest(SimpleTestCase):
    def test_every_keyword_on_a_first_scan(self):
        self.assertEqual(["a", "b"], keywords_to_import(["a", "b"], None))

    def test_only_keywords_the_file_did_not_give_before(self):
        self.assertEqual(["c"], keywords_to_import(["a", " c "], ["a", "b"]))

    def test_a_file_without_keywords_imports_none(self):
        self.assertIsNone(keywords_to_import(None, ["a"]))


class QueuedKeywordWriteTest(TestCase):
    def setUp(self):
        self.user = create_test_user(
            save_metadata_to_disk=User.SaveMetadata.SIDECAR_FILE
        )
        self.photo = create_test_photo(owner=self.user)

    def test_one_job_after_the_commit(self):
        with patch("api.metadata.jobs.enqueue_task") as queued:
            with self.captureOnCommitCallbacks() as callbacks:
                queue_keyword_write(self.user, [self.photo.id], {"b", "a"})
            queued.assert_not_called()
            for callback in callbacks:
                callback()

        queued.assert_called_once_with(
            write_photo_keywords, [self.photo.id], ["a", "b"], True
        )

    def test_nothing_without_photos_or_names_or_when_off(self):
        off = create_test_user(save_metadata_to_disk=User.SaveMetadata.OFF)
        with self.captureOnCommitCallbacks() as callbacks:
            queue_keyword_write(self.user, [], {"a"})
            queue_keyword_write(self.user, [self.photo.id], set())
            queue_keyword_write(off, [self.photo.id], {"a"})

        self.assertEqual([], callbacks)

    def test_a_failure_to_queue_is_logged(self):
        with (
            patch("api.metadata.jobs.enqueue_task", side_effect=RuntimeError("down")),
            self.assertLogs("api.metadata.jobs", "ERROR"),
            self.captureOnCommitCallbacks(execute=True),
        ):
            queue_keyword_write(self.user, [self.photo.id], {"a"})

    def test_a_failed_write_is_counted(self):
        with (
            patch(
                "api.metadata.photo_writer.write_keywords",
                side_effect=RuntimeError("bug"),
            ),
            self.assertLogs("api.metadata.jobs", "ERROR"),
        ):
            failures = write_photo_keywords([self.photo.id], ["a"], True)

        self.assertEqual(1, failures)

    def test_a_nextcloud_copy_is_not_written(self):
        with (
            patch("api.metadata.photo_writer.is_nextcloud_copy", return_value=True),
            patch("api.metadata.photo_writer.write_metadata") as write,
        ):
            failures = write_photo_keywords([self.photo.id], ["a"], False)

        self.assertEqual(0, failures)
        write.assert_not_called()

    def test_keywords_that_cannot_be_read_back_still_count_as_written(self):
        create_test_tag(self.user, name="a").photos.add(self.photo)
        PhotoMetadata.objects.update_or_create(
            photo=self.photo, defaults={"keywords": ["old"]}
        )
        reads = iter([[None, None], MetadataReadError("exif service down")])

        def read(*args, **kwargs):
            answer = next(reads)
            if isinstance(answer, Exception):
                raise answer
            return answer

        with (
            patch("api.metadata.photo_writer.get_metadata", side_effect=read),
            patch("api.metadata.photo_writer.write_metadata") as write,
            self.assertLogs("api.metadata.photo_writer", "WARNING"),
        ):
            failures = write_photo_keywords([self.photo.id], ["a"], False)

        self.assertEqual(0, failures)
        write.assert_called_once()
        self.assertEqual(["old"], PhotoMetadata.objects.get(photo=self.photo).keywords)


class KeywordEditQueuesTest(TestCase):
    """Which edits queue a keyword write, and with which tag names."""

    def setUp(self):
        self.user = create_test_user(save_metadata_to_disk=User.SaveMetadata.MEDIA_FILE)
        self.photo = create_test_photo(owner=self.user)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def _queued(self, edit):
        with patch("api.metadata.edits.queue_keyword_write") as queued:
            edit()
        return [(list(call.args[1]), set(call.args[2])) for call in queued.mock_calls]

    def test_a_keyword_edit_queues_the_names_that_changed(self):
        PhotoMetadata.objects.update_or_create(
            photo=self.photo, defaults={"keywords": ["a", "b"]}
        )

        queued = self._queued(
            lambda: edits.set_keywords(self.photo, ["b", "c"], self.user)
        )

        self.assertEqual([([self.photo.id], {"a", "c"})], queued)

    def test_the_same_keywords_again_queue_nothing_to_write(self):
        PhotoMetadata.objects.update_or_create(
            photo=self.photo, defaults={"keywords": ["a"]}
        )

        queued = self._queued(lambda: edits.set_keywords(self.photo, ["a"], self.user))

        self.assertEqual([([self.photo.id], set())], queued)

    def _tag_call(self, method, url, body=None):
        with patch("api.metadata.edits.queue_keyword_write") as queued:
            response = getattr(self.client, method)(url, body, format="json")
        self.assertIn(response.status_code, (200, 204), response.content)
        queued.assert_called_once()
        return list(queued.call_args.args[1]), list(queued.call_args.args[2])

    def test_rename_queues_the_old_and_the_new_name(self):
        tag = create_test_tag(self.user, name="Beach")
        tag.photos.add(self.photo)

        self.assertEqual(
            ([self.photo.id], ["Beach", "Seaside"]),
            self._tag_call("patch", f"/api/tags/{tag.id}/", {"name": "Seaside"}),
        )

    def test_a_rename_to_the_same_name_queues_nothing(self):
        tag = create_test_tag(self.user, name="Beach")

        with patch("api.metadata.edits.queue_keyword_write") as queued:
            response = self.client.patch(
                f"/api/tags/{tag.id}/", {"name": "Beach"}, format="json"
            )

        self.assertEqual(200, response.status_code, response.content)
        queued.assert_not_called()

    def test_delete_queues_the_photos_of_the_tag(self):
        tag = create_test_tag(self.user, name="Beach")
        tag.photos.add(self.photo)

        self.assertEqual(
            ([self.photo.id], ["Beach"]),
            self._tag_call("delete", f"/api/tags/{tag.id}/"),
        )

    def test_merge_queues_the_photos_of_the_merged_tag(self):
        target = create_test_tag(self.user, name="Holiday")
        source = create_test_tag(self.user, name="Vacation")
        source.photos.add(self.photo)

        self.assertEqual(
            ([self.photo.id], ["Vacation", "Holiday"]),
            self._tag_call("post", f"/api/tags/{target.id}/merge/", {"tag": source.id}),
        )
