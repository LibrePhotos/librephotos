"""Tests for ``scan_jobs._group_needs_processing``.

This is the per-group decision used in scan Phase 1 to skip already-scanned
photos. It was refactored to take a prebuilt set of known file paths (one query
instead of a ``Photo...exists()`` per file) and to only run the modified-time
check for files we already have on an incremental scan. These tests pin the
decision semantics so the optimization can't quietly change behavior.
"""

from unittest.mock import patch

from django.test import SimpleTestCase

from api.directory_watcher.scan_jobs import (
    _group_needs_processing,
    _select_groups_to_process,
)


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


class SelectGroupsToProcessTest(SimpleTestCase):
    """``_select_groups_to_process`` resolves known paths in batches (one query
    per batch of groups) instead of loading every known path at once, bounding
    memory on large libraries. These tests pin the batching behavior with an
    injected lookup so no DB is needed."""

    @patch(MOD, return_value=False)
    def test_new_groups_kept_known_unchanged_dropped(self, _mod):
        groups = [
            (("d", "a"), ["/d/a.jpg"]),  # known + unchanged -> skip
            (("d", "b"), ["/d/b.jpg"]),  # unknown -> process
        ]
        result = _select_groups_to_process(
            groups, lambda paths: {"/d/a.jpg"}, False, _FakeScan()
        )
        self.assertEqual(result, [(("d", "b"), ["/d/b.jpg"])])

    @patch(MOD, return_value=False)
    def test_batching_matches_single_pass_across_boundary(self, _mod):
        # 5 groups, batch_size=2 -> 3 batches; the result must be identical to
        # deciding them all at once. Every odd group is unknown (processed).
        groups = [((f"d{i}", "x"), [f"/d/{i}.jpg"]) for i in range(5)]
        known = {"/d/0.jpg", "/d/2.jpg", "/d/4.jpg"}  # evens known+unchanged

        calls = []

        def lookup(batch_paths):
            calls.append(len(batch_paths))
            return known & set(batch_paths)

        result = _select_groups_to_process(
            groups, lookup, False, _FakeScan(), batch_size=2
        )
        # odds (1, 3) are unknown -> processed; evens skipped
        self.assertEqual(
            result,
            [(("d1", "x"), ["/d/1.jpg"]), (("d3", "x"), ["/d/3.jpg"])],
        )
        # one lookup per batch: ceil(5/2) = 3
        self.assertEqual(len(calls), 3)
        self.assertEqual(calls, [2, 2, 1])

    @patch(MOD, return_value=False)
    def test_empty_input_makes_no_queries(self, _mod):
        calls = []
        result = _select_groups_to_process(
            [], lambda paths: calls.append(1) or set(), False, _FakeScan()
        )
        self.assertEqual(result, [])
        self.assertEqual(calls, [])

    def test_full_scan_processes_all_without_querying(self):
        # On a full scan every group is processed, so no known-path lookup runs.
        groups = [(("d", "a"), ["/d/a.jpg"]), (("d", "b"), ["/d/b.jpg"])]
        calls = []
        result = _select_groups_to_process(
            groups, lambda paths: calls.append(1) or set(), True, _FakeScan()
        )
        self.assertEqual(result, groups)
        self.assertEqual(calls, [])

    def test_no_baseline_processes_all_without_querying(self):
        groups = [(("d", "a"), ["/d/a.jpg"])]
        calls = []
        result = _select_groups_to_process(
            groups, lambda paths: calls.append(1) or set(), False, None
        )
        self.assertEqual(result, groups)
        self.assertEqual(calls, [])
