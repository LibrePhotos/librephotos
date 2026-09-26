"""``Photo.save()``: the diff it takes against the loaded row and the owner's
``save_metadata_to_disk`` setting that decides whether that diff is written to
disk. ``Photo._save_metadata`` is mocked, so no exiftool is needed.
"""

from unittest.mock import patch

from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext

from api.models import Photo, User
from api.tests.utils import create_test_photo, create_test_user


class SaveMetadataSettingTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)

    def _save_with(self, mode, **save_kwargs):
        User.objects.filter(pk=self.user.pk).update(save_metadata_to_disk=mode)
        loaded = Photo.objects.select_related("owner").get(pk=self.photo.pk)
        loaded.rating = 4
        with patch.object(Photo, "_save_metadata") as write:
            loaded.save(**save_kwargs)
        return write

    def test_off_writes_nothing(self):
        self._save_with(User.SaveMetadata.OFF).assert_not_called()

    def test_sidecar_file_writes_the_diff_to_the_sidecar(self):
        write = self._save_with(User.SaveMetadata.SIDECAR_FILE)
        write.assert_called_once_with(["rating"], True)

    def test_media_file_writes_the_diff_to_the_media_file(self):
        write = self._save_with(User.SaveMetadata.MEDIA_FILE)
        write.assert_called_once_with(["rating"], False)

    def test_save_metadata_false_writes_nothing(self):
        write = self._save_with(User.SaveMetadata.SIDECAR_FILE, save_metadata=False)
        write.assert_not_called()

    def test_owner_is_not_looked_up_again(self):
        """The setting is read from the ``owner`` FK, not by a second query for
        the user by username on every save."""
        User.objects.filter(pk=self.user.pk).update(
            save_metadata_to_disk=User.SaveMetadata.SIDECAR_FILE
        )
        loaded = Photo.objects.select_related("owner").get(pk=self.photo.pk)
        loaded.rating = 2
        with (
            patch.object(Photo, "_save_metadata"),
            CaptureQueriesContext(connection) as queries,
        ):
            loaded.save()

        user_table = User._meta.db_table
        user_reads = [
            q["sql"]
            for q in queries.captured_queries
            if q["sql"].lstrip().upper().startswith("SELECT")
            and f'"{user_table}"' in q["sql"]
        ]
        self.assertEqual(user_reads, [])

    def test_save_metadata_false_does_not_touch_the_owner(self):
        loaded = Photo.objects.get(pk=self.photo.pk)
        with CaptureQueriesContext(connection) as queries:
            loaded.save(save_metadata=False)

        user_table = User._meta.db_table
        self.assertFalse(
            any(f'"{user_table}"' in q["sql"] for q in queries.captured_queries)
        )


class LoadedValuesChangeTrackingTest(TestCase):
    def setUp(self):
        self.user = create_test_user(
            save_metadata_to_disk=User.SaveMetadata.SIDECAR_FILE
        )
        self.photo = create_test_photo(owner=self.user, rating=1)

    def test_instances_do_not_share_loaded_values(self):
        first = Photo(owner=self.user)
        second = Photo(owner=self.user)

        self.assertEqual(first._loaded_values, {})
        self.assertIsNot(first._loaded_values, second._loaded_values)
        self.assertNotIn("_loaded_values", vars(Photo))

    def test_loaded_instance_records_the_row(self):
        loaded = Photo.objects.get(pk=self.photo.pk)
        other = Photo.objects.get(pk=self.photo.pk)

        self.assertEqual(loaded._loaded_values["rating"], 1)
        self.assertEqual(loaded._loaded_values["owner_id"], self.user.pk)
        self.assertIsNot(loaded._loaded_values, other._loaded_values)

    def test_only_changed_fields_are_written(self):
        loaded = Photo.objects.get(pk=self.photo.pk)
        loaded.rating = 5
        with patch.object(Photo, "_save_metadata") as write:
            loaded.save()

        write.assert_called_once_with(["rating"], True)

    def test_unchanged_loaded_instance_writes_an_empty_diff(self):
        loaded = Photo.objects.get(pk=self.photo.pk)
        with patch.object(Photo, "_save_metadata") as write:
            loaded.save()

        write.assert_called_once_with([], True)

    def test_instance_built_in_memory_has_no_diff(self):
        fresh = Photo(
            owner=self.user,
            image_hash="built-in-memory",
            added_on=self.photo.added_on,
            rating=5,
        )
        with patch.object(Photo, "_save_metadata") as write:
            fresh.save()

        write.assert_called_once_with([], True)

    def test_a_loaded_instance_does_not_leak_its_row_into_new_ones(self):
        """With a class-level dict, a write to one instance's dict would show
        up in every instance built afterwards."""
        Photo.objects.get(pk=self.photo.pk)
        built = Photo(owner=self.user)
        built._loaded_values["rating"] = 3

        self.assertEqual(Photo(owner=self.user)._loaded_values, {})
