"""Tests for ``scan_jobs._group_needs_processing``.

This is the per-group decision used in scan Phase 1 to skip already-scanned
photos. It was refactored to take a prebuilt set of known file paths (one query
instead of a ``Photo...exists()`` per file) and to only run the modified-time
check for files we already have on an incremental scan. These tests pin the
decision semantics so the optimization can't quietly change behavior.
"""

from unittest.mock import patch

from django.test import SimpleTestCase

from api.directory_watcher.scan_jobs import _group_needs_processing


class _FakeScan:
    """Stand-in for a last_scan LongRunningJob — only finished_at is read."""

    finished_at = "2026-01-01T00:00:00Z"


MOD = "api.directory_watcher.scan_jobs._file_was_modified_after"


class GroupNeedsProcessingTest(SimpleTestCase):
    def test_new_file_not_in_existing_paths_is_processed(self):
        self.assertTrue(
            _group_needs_processing(["/p/a.jpg"], set(), False, _FakeScan())
        )

    def test_full_scan_always_processes(self):
        self.assertTrue(
            _group_needs_processing(["/p/a.jpg"], {"/p/a.jpg"}, True, _FakeScan())
        )

    def test_no_baseline_always_processes(self):
        self.assertTrue(
            _group_needs_processing(["/p/a.jpg"], {"/p/a.jpg"}, False, None)
        )

    @patch(MOD, return_value=False)
    def test_known_unchanged_file_is_skipped(self, _mod):
        self.assertFalse(
            _group_needs_processing(["/p/a.jpg"], {"/p/a.jpg"}, False, _FakeScan())
        )

    @patch(MOD, return_value=True)
    def test_known_but_modified_file_is_processed(self, _mod):
        self.assertTrue(
            _group_needs_processing(["/p/a.jpg"], {"/p/a.jpg"}, False, _FakeScan())
        )

    @patch(MOD, return_value=False)
    def test_group_with_one_unknown_variant_is_processed(self, _mod):
        # RAW+JPEG group where the JPEG is known but the RAW is new.
        self.assertTrue(
            _group_needs_processing(
                ["/p/a.jpg", "/p/a.cr2"], {"/p/a.jpg"}, False, _FakeScan()
            )
        )

    @patch(MOD, return_value=False)
    def test_modified_check_not_called_for_unknown_file(self, mod):
        # An unknown path short-circuits before the (expensive) mtime/sidecar
        # stats — they must not run.
        _group_needs_processing(["/p/new.jpg"], set(), False, _FakeScan())
        mod.assert_not_called()
