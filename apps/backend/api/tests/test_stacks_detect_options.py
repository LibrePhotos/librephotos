"""
Tests for the detection options accepted by DetectStacksView.

The Stacks page sends detect_raw_jpeg alongside detect_bursts (see
apps/frontend/src/components/stacks-duplicates/StacksPageContent.tsx), derived
from the user's stack_raw_jpeg preference. These tests pin down what the
backend actually does with that flag.

Current state: the flag is inert end to end. DetectStacksView drops it, and
batch_detect_stacks would ignore it even if it were forwarded, because RAW+JPEG
grouping was moved out of stack detection and into scan-time file variants
(migration 0112, api/directory_watcher/file_grouping.py). Nothing reads
User.stack_raw_jpeg either, so the Settings toggle is dead as well.

The two tests below assert the behaviour a working RAW+JPEG switch would have.
They are marked expectedFailure so they document the gap without breaking CI.
Resolving this means either:
  a) making RAW+JPEG grouping opt-out again - gate
     api/directory_watcher/file_handlers.py (the is_raw branch that calls
     find_matching_jpeg_photo) and api/directory_watcher/repair_jobs.py on
     User.stack_raw_jpeg, give batch_detect_stacks a detect_raw_jpeg branch,
     and forward it from DetectStacksView - then drop the decorators; or
  b) accepting that RAW+JPEG grouping is unconditional, and removing the dead
     "RAW + JPEG pairs" and "Live Photos" checkboxes from the frontend - then
     delete this module.
"""

import unittest
from unittest.mock import patch

from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from api.tests.utils import create_test_user


class RecordingOptions(dict):
    """A dict that remembers which keys were actually looked up."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.read_keys = set()

    def get(self, key, default=None):
        self.read_keys.add(key)
        return super().get(key, default)


class DetectStacksRawJpegOptionTestCase(TestCase):
    """The RAW+JPEG detection switch must control RAW+JPEG grouping."""

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    @unittest.expectedFailure
    @patch("api.views.stacks.async_task")
    def test_detect_raw_jpeg_is_forwarded_to_detection_job(self, mock_async_task):
        """detect_raw_jpeg sent by the client must reach the detection job."""
        response = self.client.post(
            "/api/stacks/detect",
            {"detect_bursts": True, "detect_raw_jpeg": False},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED)

        _task, _user, options = mock_async_task.call_args[0]
        self.assertIn("detect_raw_jpeg", options)
        self.assertFalse(options["detect_raw_jpeg"])
        self.assertEqual(response.json()["options"]["detect_raw_jpeg"], False)

    @unittest.expectedFailure
    def test_detection_job_consumes_detect_raw_jpeg(self):
        """Forwarding the flag only matters if the detection job reads it."""
        from api.stack_detection import batch_detect_stacks

        options = RecordingOptions(
            {"detect_bursts": False, "detect_raw_jpeg": False},
        )
        batch_detect_stacks(self.user, options)

        self.assertIn(
            "detect_raw_jpeg",
            options.read_keys,
            "batch_detect_stacks never looks at detect_raw_jpeg, so forwarding "
            "it from the view alone cannot make the switch do anything",
        )
