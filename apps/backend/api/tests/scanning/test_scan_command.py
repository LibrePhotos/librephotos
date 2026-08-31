"""Characterization tests for the ``scan`` management command (unit 17).

Pins the CURRENT behaviour of ``api.management.commands.scan.Command.handle``
(and the ``nextcloud_scan`` helper it delegates to) before the command is
refactored.

Nothing heavy runs: both ``scan_photos`` (directory watcher) and
``scan_photos_nextcloud`` are patched at their import site inside the command
module, so no filesystem walking, ML work or Nextcloud HTTP happens.

Some assertions encode quirks of the current implementation; each is called
out in a comment so the refactorer knows they are deliberate.
"""

import io
import uuid
from contextlib import redirect_stdout
from unittest.mock import patch

from django.core.management import CommandError, call_command
from django.test import TestCase

from api.models import User
from api.models.user import get_deleted_user
from api.tests.utils import create_test_user

MODULE = "api.management.commands.scan"


class ScanCommandBaseTest(TestCase):
    def setUp(self):
        # ``get_deleted_user`` creates the sentinel "deleted" user on first
        # call; create it up-front so every test sees the same user set.
        self.deleted_user = get_deleted_user()

    def call_scan(self, *args, **options):
        # ``nextcloud_scan`` uses bare ``print``, not ``self.stdout``, so the
        # command's stdout kwarg does not capture it -- redirect the real
        # stdout as well.
        out = io.StringIO()
        with redirect_stdout(out):
            call_command("scan", *args, stdout=out, stderr=out, **options)
        return out.getvalue()


class ScanDirectoryScanTest(ScanCommandBaseTest):
    """Default branch: a directory scan for every non-deleted user."""

    def test_scans_every_non_deleted_user_with_their_scan_directory(self):
        alice = create_test_user(scan_directory="/data/alice")
        bob = create_test_user(scan_directory="/data/bob")

        with patch(f"{MODULE}.scan_photos") as scan_photos:
            self.call_scan()

        self.assertEqual(scan_photos.call_count, 2)
        scanned = {c.args[0]: c for c in scan_photos.call_args_list}
        self.assertEqual(set(scanned), {alice, bob})
        # positional signature: (user, full_scan, job_id, scan_directory)
        for user, call in scanned.items():
            self.assertEqual(call.args[1], False)
            self.assertIsInstance(call.args[2], uuid.UUID)
            self.assertEqual(call.args[3], user.scan_directory)
            self.assertEqual(call.kwargs, {})

    def test_deleted_user_is_never_scanned(self):
        create_test_user(scan_directory="/data/alice")

        with patch(f"{MODULE}.scan_photos") as scan_photos:
            self.call_scan()

        scanned_users = [c.args[0] for c in scan_photos.call_args_list]
        self.assertNotIn(self.deleted_user, scanned_users)

    def test_full_scan_flag_is_forwarded(self):
        create_test_user(scan_directory="/data/alice")

        with patch(f"{MODULE}.scan_photos") as scan_photos:
            self.call_scan("--full-scan")

        self.assertEqual(scan_photos.call_args.args[1], True)

    def test_each_user_gets_a_distinct_job_id(self):
        create_test_user(scan_directory="/data/alice")
        create_test_user(scan_directory="/data/bob")

        with patch(f"{MODULE}.scan_photos") as scan_photos:
            self.call_scan()

        job_ids = [c.args[2] for c in scan_photos.call_args_list]
        self.assertEqual(len(set(job_ids)), 2)

    def test_user_with_empty_scan_directory_is_still_scanned(self):
        # Current behaviour: no guard on an unconfigured scan_directory, the
        # empty string is handed straight to scan_photos.
        user = create_test_user()

        with patch(f"{MODULE}.scan_photos") as scan_photos:
            self.call_scan()

        self.assertEqual(scan_photos.call_count, 1)
        self.assertEqual(scan_photos.call_args.args[0], user)
        self.assertEqual(scan_photos.call_args.args[3], "")

    def test_only_deleted_user_exists_means_no_scan(self):
        with patch(f"{MODULE}.scan_photos") as scan_photos:
            self.call_scan()

        scan_photos.assert_not_called()

    def test_directory_scan_does_not_touch_nextcloud(self):
        create_test_user(scan_directory="/data/alice")

        with (
            patch(f"{MODULE}.scan_photos"),
            patch(f"{MODULE}.scan_photos_nextcloud") as nc,
        ):
            self.call_scan()

        nc.assert_not_called()

    def test_scan_photos_exception_propagates(self):
        # Current behaviour: unlike the nextcloud branch, the directory scan
        # has no try/except, so a failing user aborts the whole command.
        create_test_user(scan_directory="/data/alice")

        with patch(f"{MODULE}.scan_photos", side_effect=RuntimeError("boom")):
            with self.assertRaises(RuntimeError):
                self.call_scan()


class ScanFilesTest(ScanCommandBaseTest):
    """``--scan-files`` branch: route each path to the owning user."""

    def test_files_are_routed_to_the_user_owning_the_prefix(self):
        alice = create_test_user(scan_directory="/data/alice")
        bob = create_test_user(scan_directory="/data/bob")

        with patch(f"{MODULE}.scan_photos") as scan_photos:
            self.call_scan(
                "--scan-files",
                "/data/alice/a.jpg",
                "/data/alice/b.jpg",
                "/data/bob/c.jpg",
            )

        self.assertEqual(scan_photos.call_count, 2)
        by_user = {c.args[0]: c for c in scan_photos.call_args_list}
        self.assertEqual(set(by_user), {alice, bob})
        self.assertEqual(
            by_user[alice].kwargs["scan_files"],
            ["/data/alice/a.jpg", "/data/alice/b.jpg"],
        )
        self.assertEqual(by_user[bob].kwargs["scan_files"], ["/data/bob/c.jpg"])
        # full_scan is hard-coded False here and no scan_directory is passed.
        self.assertEqual(by_user[alice].args[1], False)
        self.assertIsInstance(by_user[alice].args[2], uuid.UUID)
        self.assertEqual(len(by_user[alice].args), 3)

    def test_user_without_matching_files_is_not_scanned(self):
        create_test_user(scan_directory="/data/alice")
        create_test_user(scan_directory="/data/bob")

        with patch(f"{MODULE}.scan_photos") as scan_photos:
            self.call_scan("--scan-files", "/data/alice/a.jpg")

        self.assertEqual(scan_photos.call_count, 1)
        self.assertEqual(scan_photos.call_args.args[0].scan_directory, "/data/alice")

    def test_no_matching_user_means_no_scan(self):
        create_test_user(scan_directory="/data/alice")

        with patch(f"{MODULE}.scan_photos") as scan_photos:
            self.call_scan("--scan-files", "/elsewhere/a.jpg")

        scan_photos.assert_not_called()

    def test_deleted_user_is_skipped_even_when_prefix_matches(self):
        # The deleted user's scan_directory is "" which prefixes every path,
        # but the explicit ``continue`` keeps it out.
        with patch(f"{MODULE}.scan_photos") as scan_photos:
            self.call_scan("--scan-files", "/anything/a.jpg")

        scan_photos.assert_not_called()

    def test_empty_scan_directory_matches_every_file(self):
        # BUG (pinned as current behaviour): a user whose scan_directory has
        # never been configured has "" as prefix, so ``startswith("")`` is
        # true for every path and the user gets every file handed to them.
        user = create_test_user()

        with patch(f"{MODULE}.scan_photos") as scan_photos:
            self.call_scan("--scan-files", "/somewhere/else/a.jpg")

        self.assertEqual(scan_photos.call_count, 1)
        self.assertEqual(scan_photos.call_args.args[0], user)
        self.assertEqual(
            scan_photos.call_args.kwargs["scan_files"], ["/somewhere/else/a.jpg"]
        )

    def test_prefix_match_is_a_plain_string_prefix_not_a_path_boundary(self):
        # BUG (pinned): "/data/alice2/x.jpg" starts with "/data/alice" so it
        # leaks into alice's scan as well as alice2's.
        create_test_user(scan_directory="/data/alice")
        create_test_user(scan_directory="/data/alice2")

        with patch(f"{MODULE}.scan_photos") as scan_photos:
            self.call_scan("--scan-files", "/data/alice2/x.jpg")

        self.assertEqual(scan_photos.call_count, 2)
        for call in scan_photos.call_args_list:
            self.assertEqual(call.kwargs["scan_files"], ["/data/alice2/x.jpg"])

    def test_empty_scan_files_list_falls_through_to_directory_scan(self):
        user = create_test_user(scan_directory="/data/alice")

        with patch(f"{MODULE}.scan_photos") as scan_photos:
            self.call_scan(scan_files=[])

        self.assertEqual(scan_photos.call_count, 1)
        # 4 positional args == directory-scan branch
        self.assertEqual(scan_photos.call_args.args[3], user.scan_directory)


class NextcloudScanTest(ScanCommandBaseTest):
    """``--nextcloud`` branch."""

    def test_nextcloud_flag_short_circuits_the_directory_scan(self):
        create_test_user(
            scan_directory="/data/alice", nextcloud_scan_directory="/nc/alice"
        )

        with (
            patch(f"{MODULE}.scan_photos") as scan_photos,
            patch(f"{MODULE}.scan_photos_nextcloud") as nc,
        ):
            self.call_scan("--nextcloud")

        scan_photos.assert_not_called()
        self.assertEqual(nc.call_count, 1)
        self.assertIsInstance(nc.call_args.args[1], uuid.UUID)

    def test_users_without_nextcloud_directory_are_skipped(self):
        skipped = create_test_user(nextcloud_scan_directory="")
        configured = create_test_user(nextcloud_scan_directory="/nc/bob")

        with patch(f"{MODULE}.scan_photos_nextcloud") as nc:
            output = self.call_scan("--nextcloud")

        self.assertEqual(nc.call_count, 1)
        self.assertEqual(nc.call_args.args[0], configured)
        self.assertIn(
            f"Skipping nextcloud scan for user {skipped.username}. "
            "No scan directory configured.",
            output,
        )
        self.assertIn(
            f"Starting nextcloud scan for user {configured.username}.", output
        )

    def test_deleted_user_is_not_excluded_from_nextcloud_scan(self):
        # Current behaviour: nextcloud_scan has no deleted-user guard; the
        # sentinel user is only skipped because it has no scan directory.
        self.deleted_user.nextcloud_scan_directory = "/nc/deleted"
        self.deleted_user.save()

        with patch(f"{MODULE}.scan_photos_nextcloud") as nc:
            self.call_scan("--nextcloud")

        self.assertEqual(nc.call_count, 1)
        self.assertEqual(nc.call_args.args[0], self.deleted_user)

    def test_failure_for_one_user_does_not_stop_the_others(self):
        first = create_test_user(nextcloud_scan_directory="/nc/a")
        create_test_user(nextcloud_scan_directory="/nc/b")

        with patch(
            f"{MODULE}.scan_photos_nextcloud", side_effect=RuntimeError("boom")
        ) as nc:
            output = self.call_scan("--nextcloud")

        # Exception is swallowed per user; the command still exits cleanly.
        self.assertEqual(nc.call_count, 2)
        self.assertIn(f"Nextcloud scan for user {first.username} failed:", output)
        self.assertIn("RuntimeError: boom", output)

    def test_no_users_with_nextcloud_directory_means_no_scan(self):
        create_test_user()

        with patch(f"{MODULE}.scan_photos_nextcloud") as nc:
            self.call_scan("--nextcloud")

        nc.assert_not_called()


class ScanArgumentParsingTest(ScanCommandBaseTest):
    def test_flags_are_mutually_exclusive(self):
        with self.assertRaises(CommandError):
            self.call_scan("--full-scan", "--nextcloud")

    def test_scan_files_and_nextcloud_are_mutually_exclusive(self):
        with self.assertRaises(CommandError):
            self.call_scan("--nextcloud", "--scan-files", "/data/a.jpg")

    def test_short_flags_are_accepted(self):
        create_test_user(scan_directory="/data/alice")

        with patch(f"{MODULE}.scan_photos") as scan_photos:
            self.call_scan("-f")

        self.assertEqual(scan_photos.call_args.args[1], True)

    def test_get_deleted_user_is_created_on_demand(self):
        # ``handle`` calls get_deleted_user(), which creates the sentinel.
        User.objects.filter(username="deleted").delete()
        self.assertFalse(User.objects.filter(username="deleted").exists())

        with patch(f"{MODULE}.scan_photos") as scan_photos:
            self.call_scan()

        deleted = User.objects.get(username="deleted")
        self.assertFalse(deleted.is_active)
        scan_photos.assert_not_called()
