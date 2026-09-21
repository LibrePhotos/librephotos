"""Characterization tests for the ``save_metadata`` management command.

These pin the CURRENT behavior of ``Command.handle`` in
``api/management/commands/save_metadata.py`` before it is refactored.
Nothing here asserts what the command *should* do -- only what it does today.

``Photo._save_metadata`` is always mocked so no exiftool binary, sidecar file
or media file is ever touched.
"""

from io import StringIO
from unittest.mock import MagicMock, patch

from django.core.management import call_command
from django.test import TestCase

from api.models import Photo
from api.tests.utils import create_test_face, create_test_photo, create_test_user


def run_command(*args):
    """Run ``save_metadata`` with mocked writes; return (stdout, stderr, mock)."""
    out, err = StringIO(), StringIO()
    with patch.object(Photo, "_save_metadata") as save_mock:
        call_command("save_metadata", *args, stdout=out, stderr=err)
    return out.getvalue(), err.getvalue(), save_mock


class SaveMetadataCommandTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.other_user = create_test_user()

    # ------------------------------------------------------------------
    # happy path
    # ------------------------------------------------------------------
    def test_writes_every_photo_with_defaults(self):
        photos = [create_test_photo(owner=self.user) for _ in range(3)]

        out, err, save_mock = run_command()

        self.assertIn("Found 3 photos to process (types: ['ratings'])", out)
        self.assertIn("Done. 3 written, 0 errors out of 3 photos.", out)
        self.assertEqual(err, "")
        self.assertEqual(save_mock.call_count, 3)
        # default: sidecar is used (``--media-file`` not given) and only ratings
        for call in save_mock.call_args_list:
            self.assertEqual(call.args, ())
            self.assertEqual(
                call.kwargs, {"use_sidecar": True, "metadata_types": ["ratings"]}
            )
        self.assertEqual(len(photos), 3)

    def test_media_file_flag_disables_sidecar(self):
        create_test_photo(owner=self.user)

        _, _, save_mock = run_command("--media-file")

        self.assertEqual(save_mock.call_args.kwargs["use_sidecar"], False)

    def test_sidecar_flag_is_a_no_op_with_media_file(self):
        """``--sidecar`` is ignored entirely; only ``--media-file`` matters.

        Passing both leaves ``use_sidecar`` False -- pinning today's behavior,
        not endorsing it.
        """
        create_test_photo(owner=self.user)

        _, _, save_mock = run_command("--sidecar", "--media-file")

        self.assertEqual(save_mock.call_args.kwargs["use_sidecar"], False)

    def test_types_option_is_passed_through(self):
        photo = create_test_photo(owner=self.user)
        create_test_face(photo=photo, deleted=False)

        _, _, save_mock = run_command("--types", "ratings", "face_tags")

        self.assertEqual(
            save_mock.call_args.kwargs["metadata_types"], ["ratings", "face_tags"]
        )

    def test_no_photos_reports_zero(self):
        out, err, save_mock = run_command()

        self.assertIn("Found 0 photos to process", out)
        self.assertIn("Done. 0 written, 0 errors out of 0 photos.", out)
        self.assertEqual(save_mock.call_count, 0)
        self.assertEqual(err, "")

    # ------------------------------------------------------------------
    # --user filtering
    # ------------------------------------------------------------------
    def test_user_option_restricts_to_owner(self):
        create_test_photo(owner=self.user)
        create_test_photo(owner=self.other_user)

        out, _, save_mock = run_command("--user", self.user.username)

        self.assertIn("Found 1 photos to process", out)
        self.assertEqual(save_mock.call_count, 1)

    def test_unknown_user_writes_stderr_and_returns_early(self):
        create_test_photo(owner=self.user)

        out, err, save_mock = run_command("--user", "nope-does-not-exist")

        self.assertIn("User 'nope-does-not-exist' not found", err)
        # returns before printing the "Found N photos" line
        self.assertEqual(out, "")
        self.assertEqual(save_mock.call_count, 0)

    # ------------------------------------------------------------------
    # face_tags-only filtering
    # ------------------------------------------------------------------
    def test_face_tags_only_filters_to_photos_with_live_faces(self):
        with_face = create_test_photo(owner=self.user)
        create_test_face(photo=with_face, deleted=False)
        create_test_photo(owner=self.user)  # no faces at all

        out, _, save_mock = run_command("--types", "face_tags")

        self.assertIn("Found 1 photos to process (types: ['face_tags'])", out)
        self.assertEqual(save_mock.call_count, 1)

    def test_face_tags_only_skips_photos_whose_faces_are_deleted(self):
        photo = create_test_photo(owner=self.user)
        create_test_face(photo=photo, deleted=True)

        out, _, save_mock = run_command("--types", "face_tags")

        self.assertIn("Found 0 photos to process", out)
        self.assertEqual(save_mock.call_count, 0)

    def test_face_tags_photo_with_many_faces_counted_once(self):
        photo = create_test_photo(owner=self.user)
        create_test_face(photo=photo, deleted=False)
        create_test_face(photo=photo, deleted=False)

        out, _, save_mock = run_command("--types", "face_tags")

        self.assertIn("Found 1 photos to process", out)
        self.assertEqual(save_mock.call_count, 1)

    def test_face_filter_not_applied_when_ratings_also_requested(self):
        """The filter only fires for the exact list ``["face_tags"]``."""
        create_test_photo(owner=self.user)  # no faces

        out, _, save_mock = run_command("--types", "face_tags", "ratings")

        self.assertIn("Found 1 photos to process", out)
        self.assertEqual(save_mock.call_count, 1)

    # ------------------------------------------------------------------
    # --dry-run
    # ------------------------------------------------------------------
    def test_dry_run_reports_count_and_writes_nothing(self):
        create_test_photo(owner=self.user)
        create_test_photo(owner=self.user)

        out, err, save_mock = run_command("--dry-run")

        self.assertIn("Found 2 photos to process", out)
        self.assertIn("Dry run", out)
        self.assertNotIn("Done.", out)
        self.assertEqual(save_mock.call_count, 0)
        self.assertEqual(err, "")

    def test_dry_run_still_validates_user(self):
        out, err, save_mock = run_command("--dry-run", "--user", "ghost")

        self.assertIn("User 'ghost' not found", err)
        self.assertEqual(out, "")
        self.assertEqual(save_mock.call_count, 0)

    # ------------------------------------------------------------------
    # error handling
    # ------------------------------------------------------------------
    def test_write_failures_are_counted_and_do_not_abort_the_run(self):
        photos = [create_test_photo(owner=self.user) for _ in range(3)]
        failing_hash = photos[1].image_hash

        out, err = StringIO(), StringIO()

        def side_effect(self_photo, **kwargs):
            if self_photo.image_hash == failing_hash:
                raise ValueError("boom")

        with patch.object(Photo, "_save_metadata", autospec=True) as save_mock:
            save_mock.side_effect = side_effect
            call_command("save_metadata", stdout=out, stderr=err)

        self.assertEqual(save_mock.call_count, 3)
        self.assertIn(f"Error writing {failing_hash}: boom", err.getvalue())
        self.assertIn("Done. 2 written, 1 errors out of 3 photos.", out.getvalue())

    def test_all_failures_still_reports_success_styled_summary(self):
        create_test_photo(owner=self.user)

        out, err = StringIO(), StringIO()
        with patch.object(Photo, "_save_metadata", side_effect=OSError("no exiftool")):
            call_command("save_metadata", stdout=out, stderr=err)

        self.assertIn("no exiftool", err.getvalue())
        self.assertIn("Done. 0 written, 1 errors out of 1 photos.", out.getvalue())

    # ------------------------------------------------------------------
    # progress reporting (every 100 photos) -- driven by a fake queryset so
    # the test does not have to build 100 real Photo rows.
    # ------------------------------------------------------------------
    def test_progress_line_printed_every_hundred_photos(self):
        fake_photos = []
        for i in range(250):
            p = MagicMock()
            p.image_hash = f"hash{i}"
            fake_photos.append(p)

        queryset = MagicMock()
        queryset.count.return_value = 250
        queryset.iterator.return_value = iter(fake_photos)

        out, err = StringIO(), StringIO()
        with patch("api.management.commands.save_metadata.Photo") as photo_cls:
            photo_cls.objects.all.return_value = queryset
            call_command("save_metadata", stdout=out, stderr=err)

        value = out.getvalue()
        self.assertIn("Progress: 100/250 (100 written, 0 errors)", value)
        self.assertIn("Progress: 200/250 (200 written, 0 errors)", value)
        self.assertNotIn("Progress: 250/250", value)
        self.assertIn("Done. 250 written, 0 errors out of 250 photos.", value)
        for p in fake_photos:
            p._save_metadata.assert_called_once_with(
                use_sidecar=True, metadata_types=["ratings"]
            )

    def test_total_is_counted_before_iteration(self):
        """``total`` in the summary comes from ``count()``, not the loop."""
        queryset = MagicMock()
        queryset.count.return_value = 7  # deliberately disagrees with iterator
        queryset.iterator.return_value = iter([MagicMock(), MagicMock()])

        out, err = StringIO(), StringIO()
        with patch("api.management.commands.save_metadata.Photo") as photo_cls:
            photo_cls.objects.all.return_value = queryset
            call_command("save_metadata", stdout=out, stderr=err)

        self.assertIn("Found 7 photos to process", out.getvalue())
        self.assertIn("Done. 2 written, 0 errors out of 7 photos.", out.getvalue())

    # ------------------------------------------------------------------
    # argument parsing
    # ------------------------------------------------------------------
    def test_invalid_type_choice_is_rejected(self):
        from django.core.management.base import CommandError

        with self.assertRaises(CommandError):
            call_command("save_metadata", "--types", "captions")
