"""Tests for the ``save_metadata`` management command.

It writes through the "Write metadata to files" job's ``write_photos``
(#2287): each user's photos to that user's target ("Write edits to files":
sidecar or media file), photos of owners who have it Off are skipped (#2293),
and only the types a photo carries a value of are written. ``--sidecar`` /
``--media-file`` override the owner's setting and need ``--user``.

The writers are mocked (``MockWriters``), so no ExifTool runs.
"""

import datetime
from io import StringIO
from unittest import mock

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import TestCase

from api.metadata import library_write
from api.metadata.writer import MetadataWriteError
from api.models import User
from api.tests.metadata.test_library_write import MockWriters
from api.tests.utils import create_test_face, create_test_photo, create_test_user

DATE = datetime.datetime(2011, 11, 11, 11, 11, tzinfo=datetime.timezone.utc)


def run_command(*args, fail=None):
    """Run ``save_metadata`` with mocked writers; return (stdout, stderr, calls)."""
    out, err = StringIO(), StringIO()
    with MockWriters(fail=fail) as writers:
        call_command("save_metadata", *args, stdout=out, stderr=err)
    return out.getvalue(), err.getvalue(), writers.calls


class SaveMetadataCommandTest(TestCase):
    def setUp(self):
        self.user = create_test_user(
            save_metadata_to_disk=User.SaveMetadata.SIDECAR_FILE
        )

    def test_writes_what_each_photo_carries(self):
        rated = create_test_photo(owner=self.user, rating=3)
        dated = create_test_photo(owner=self.user, timestamp=DATE)
        create_test_photo(owner=self.user)

        out, err, calls = run_command()

        self.assertEqual(
            {("ratings", rated.pk, True), ("dates", dated.pk, True)}, set(calls)
        )
        self.assertIn(f"{self.user.username}: 2 photos to write to sidecar files", out)
        self.assertIn("Done. 2 written, 0 skipped, 0 failed.", out)
        self.assertEqual("", err)

    def test_face_tags_follow_the_users_switch(self):
        photo = create_test_photo(owner=self.user)
        create_test_face(photo=photo)

        _, _, calls = run_command()
        self.assertEqual([], calls)

        User.objects.filter(pk=self.user.pk).update(save_face_tags_to_disk=True)
        _, _, calls = run_command()
        self.assertEqual([("face_tags", photo.pk, True)], calls)

    def test_follows_each_owners_target(self):
        media_user = create_test_user(
            save_metadata_to_disk=User.SaveMetadata.MEDIA_FILE
        )
        sidecar_photo = create_test_photo(owner=self.user, rating=1)
        media_photo = create_test_photo(owner=media_user, rating=1)

        _, _, calls = run_command()

        self.assertEqual(
            {("ratings", sidecar_photo.pk, True), ("ratings", media_photo.pk, False)},
            set(calls),
        )

    def test_skips_owners_with_sync_off(self):
        off_user = create_test_user(save_metadata_to_disk=User.SaveMetadata.OFF)
        create_test_photo(owner=off_user, rating=2)
        create_test_photo(owner=off_user, rating=2)
        create_test_photo(owner=self.user, rating=2)

        out, err, calls = run_command()

        self.assertIn("Skipping 2 photos of users with 'Write edits to files' Off", out)
        self.assertEqual(1, len(calls))
        self.assertEqual("", err)

    def test_help_names_the_setting_as_the_ui_does(self):
        from api.management.commands.save_metadata import Command

        # Renamed in the UI (#2609); the old name is gone (#2670).
        self.assertIn("'Write edits to files'", Command.help)
        self.assertNotIn("Synchronize", Command.help)

    def test_user_with_sync_off_is_skipped_without_an_override(self):
        off_user = create_test_user(save_metadata_to_disk=User.SaveMetadata.OFF)
        create_test_photo(owner=off_user, rating=2)
        create_test_photo(owner=self.user, rating=2)

        out, _, calls = run_command("--user", off_user.username)

        self.assertIn("Skipping 1 photos", out)
        self.assertEqual([], calls)

    def test_media_file_flag_overrides_the_users_setting(self):
        photo = create_test_photo(owner=self.user, rating=2)

        _, _, calls = run_command("--media-file", "--user", self.user.username)

        self.assertEqual([("ratings", photo.pk, False)], calls)

    def test_sidecar_flag_overrides_sync_off(self):
        off_user = create_test_user(save_metadata_to_disk=User.SaveMetadata.OFF)
        photo = create_test_photo(owner=off_user, rating=2)

        out, _, calls = run_command("--sidecar", "--user", off_user.username)

        self.assertNotIn("Skipping", out)
        self.assertEqual([("ratings", photo.pk, True)], calls)

    def test_an_override_needs_a_user(self):
        for flag in ("--sidecar", "--media-file"):
            with self.subTest(flag=flag), self.assertRaises(CommandError):
                run_command(flag)

    def test_sidecar_and_media_file_are_exclusive(self):
        with self.assertRaises(CommandError):
            run_command("--sidecar", "--media-file", "--user", self.user.username)

    def test_types_option_limits_the_writes(self):
        photo = create_test_photo(owner=self.user, rating=2, timestamp=DATE)
        create_test_face(photo=photo)

        _, _, calls = run_command("--types", "face_tags", "dates")

        self.assertEqual(
            {("dates", photo.pk, True), ("face_tags", photo.pk, True)}, set(calls)
        )

    def test_user_option_restricts_to_owner(self):
        create_test_photo(owner=self.user, rating=2)
        other = create_test_user(save_metadata_to_disk=User.SaveMetadata.SIDECAR_FILE)
        create_test_photo(owner=other, rating=2)

        _, _, calls = run_command("--user", self.user.username)

        self.assertEqual(1, len(calls))

    def test_unknown_user_is_an_error(self):
        with self.assertRaisesMessage(CommandError, "User 'ghost' not found"):
            run_command("--user", "ghost")

    def test_dry_run_counts_and_writes_nothing(self):
        create_test_photo(owner=self.user, rating=2, timestamp=DATE)
        create_test_photo(owner=self.user, rating=2)

        out, err, calls = run_command("--dry-run")

        self.assertIn("2 photos to write", out)
        self.assertIn("  ratings: 2 photos", out)
        self.assertIn("  dates: 1 photos", out)
        self.assertIn("Dry run", out)
        self.assertNotIn("Done.", out)
        self.assertEqual([], calls)
        self.assertEqual("", err)

    def test_write_failures_are_counted_and_do_not_abort_the_run(self):
        photos = [create_test_photo(owner=self.user, rating=2) for _ in range(3)]
        failing = photos[1]
        fail = {("ratings", failing.pk): MetadataWriteError("x", "read-only")}

        out, err, calls = run_command(fail=fail)

        self.assertEqual(3, len(calls))
        self.assertIn(
            f"Error writing {failing.main_file.path}: ratings: read-only", err
        )
        self.assertIn("Done. 2 written, 0 skipped, 1 failed.", out)

    def test_writes_in_batches_with_progress(self):
        for _ in range(3):
            create_test_photo(owner=self.user, rating=2)

        with (
            mock.patch.object(library_write, "BATCH_SIZE", 2),
            mock.patch("api.management.commands.save_metadata.BATCH_SIZE", 2),
        ):
            out, _, calls = run_command()

        self.assertEqual(3, len(calls))
        self.assertIn("Progress: 2/3", out)
        self.assertIn("Progress: 3/3", out)

    def test_invalid_type_choice_is_rejected(self):
        with self.assertRaises(CommandError):
            call_command("save_metadata", "--types", "titles")
