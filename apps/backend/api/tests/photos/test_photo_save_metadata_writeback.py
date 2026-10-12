"""``Photo.save()`` only saves; an edit is written to disk by its caller.

``Photo.save()`` used to diff the instance against the row it was loaded from
and write the changed rating and date to the file as a side effect (#2295,
#2298). It now writes nothing, whatever the owner's "Synchronize metadata to
disk" says (#2336). A path that applies a user's edit calls
``write_photo_metadata_on_commit`` with the fields it changed, which follows
that setting and waits for the commit.
"""

import inspect
from unittest.mock import patch

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from api.metadata.photo_writer import write_photo_metadata_on_commit
from api.models import Photo, User
from api.tests.utils import create_test_photo, create_test_user

SYNCING_MODES = (User.SaveMetadata.SIDECAR_FILE, User.SaveMetadata.MEDIA_FILE)


class PhotoSaveWritesNothingTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user, rating=1)

    def test_a_changed_rating_is_not_written_whatever_the_setting(self):
        # The file says 1 (the row was made from it); the save says 4.
        for mode in SYNCING_MODES:
            with self.subTest(mode=mode):
                User.objects.filter(pk=self.user.pk).update(save_metadata_to_disk=mode)
                loaded = Photo.objects.select_related("owner").get(pk=self.photo.pk)
                loaded.rating = 4
                loaded.timestamp = None
                with (
                    patch("api.metadata.photo_writer.write_metadata") as write,
                    patch("api.metadata.writer.write_metadata") as low_level_write,
                    self.captureOnCommitCallbacks(execute=True) as callbacks,
                ):
                    loaded.save()

                write.assert_not_called()
                low_level_write.assert_not_called()
                self.assertEqual([], callbacks)
                self.assertEqual(4, Photo.objects.get(pk=self.photo.pk).rating)

    def test_save_takes_no_save_metadata_argument(self):
        self.assertNotIn("save_metadata", inspect.signature(Photo.save).parameters)

    def test_the_model_keeps_no_write_back_state(self):
        loaded = Photo.objects.get(pk=self.photo.pk)
        self.assertFalse(hasattr(loaded, "_loaded_values"))
        self.assertFalse(hasattr(Photo, "_save_metadata"))

    def test_save_does_not_touch_the_owner(self):
        loaded = Photo.objects.get(pk=self.photo.pk)
        loaded.rating = 3
        with CaptureQueriesContext(connection) as queries:
            loaded.save()

        user_table = User._meta.db_table
        self.assertFalse(
            any(f'"{user_table}"' in q["sql"] for q in queries.captured_queries)
        )


class WriteOnCommitTest(TestCase):
    """``write_photo_metadata_on_commit``: the owner's setting, after the commit."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user, rating=1)

    def _write_with(self, mode, fields=("rating",)):
        User.objects.filter(pk=self.user.pk).update(save_metadata_to_disk=mode)
        loaded = Photo.objects.select_related("owner").get(pk=self.photo.pk)
        with (
            patch("api.metadata.photo_writer.write_photo_metadata") as write,
            self.captureOnCommitCallbacks(execute=True),
        ):
            write_photo_metadata_on_commit(loaded, list(fields))
        return loaded, write

    def test_off_writes_nothing(self):
        _, write = self._write_with(User.SaveMetadata.OFF)
        write.assert_not_called()

    def test_sidecar_file_writes_the_fields_to_the_sidecar(self):
        loaded, write = self._write_with(User.SaveMetadata.SIDECAR_FILE)
        write.assert_called_once_with(loaded, ["rating"], True)

    def test_media_file_writes_the_fields_to_the_media_file(self):
        loaded, write = self._write_with(
            User.SaveMetadata.MEDIA_FILE, fields=("timestamp",)
        )
        write.assert_called_once_with(loaded, ["timestamp"], False)

    def test_nothing_is_written_before_the_commit(self):
        User.objects.filter(pk=self.user.pk).update(
            save_metadata_to_disk=User.SaveMetadata.SIDECAR_FILE
        )
        loaded = Photo.objects.select_related("owner").get(pk=self.photo.pk)
        with (
            patch("api.metadata.photo_writer.write_photo_metadata") as write,
            self.captureOnCommitCallbacks() as callbacks,
        ):
            write_photo_metadata_on_commit(loaded, ["rating"])
            write.assert_not_called()

        # The callbacks are collected when the block ends: the commit.
        self.assertEqual(1, len(callbacks))

    def test_a_failed_write_keeps_the_saved_edit(self):
        User.objects.filter(pk=self.user.pk).update(
            save_metadata_to_disk=User.SaveMetadata.SIDECAR_FILE
        )
        loaded = Photo.objects.select_related("owner").get(pk=self.photo.pk)
        loaded.rating = 5
        with (
            patch(
                "api.metadata.photo_writer.write_photo_metadata",
                side_effect=OSError("disk full"),
            ),
            self.assertLogs("django", "ERROR"),
            self.captureOnCommitCallbacks(execute=True),
        ):
            loaded.save()
            write_photo_metadata_on_commit(loaded, ["rating"])

        self.assertEqual(5, Photo.objects.get(pk=self.photo.pk).rating)

    def test_owner_is_not_looked_up_again(self):
        """The setting is read from the ``owner`` FK, not by a second query."""
        User.objects.filter(pk=self.user.pk).update(
            save_metadata_to_disk=User.SaveMetadata.SIDECAR_FILE
        )
        loaded = Photo.objects.select_related("owner").get(pk=self.photo.pk)
        with (
            patch("api.metadata.photo_writer.write_photo_metadata"),
            CaptureQueriesContext(connection) as queries,
        ):
            write_photo_metadata_on_commit(loaded, ["rating"])

        user_table = User._meta.db_table
        self.assertEqual(
            [],
            [
                q["sql"]
                for q in queries.captured_queries
                if f'"{user_table}"' in q["sql"]
            ],
        )
