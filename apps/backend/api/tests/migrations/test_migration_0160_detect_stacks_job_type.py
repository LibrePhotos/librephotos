import importlib

from django.apps import apps as global_apps
from django.test import TestCase

from api.models import LongRunningJob

from ..utils import create_test_job, create_test_user

# The module name starts with a digit, so a plain import cannot load it.
migration_0160 = importlib.import_module("api.migrations.0160_detect_stacks_job_type")


class DetectStacksJobTypeMigrationTest(TestCase):
    """Past stack detections ran on Scan Photos rows."""

    def test_moves_stack_detections_to_their_own_type(self):
        user = create_test_user()
        stacks = create_test_job(
            started_by=user, result={"status": "completed", "stacks_found": 3}
        )
        scan = create_test_job(started_by=user, result={"library_scan": True})
        unmarked = create_test_job(started_by=user)

        migration_0160.move_stack_detection_rows(global_apps, None)

        stacks.refresh_from_db()
        scan.refresh_from_db()
        unmarked.refresh_from_db()
        self.assertEqual(stacks.job_type, LongRunningJob.JOB_DETECT_STACKS)
        self.assertEqual(scan.job_type, LongRunningJob.JOB_SCAN_PHOTOS)
        self.assertEqual(unmarked.job_type, LongRunningJob.JOB_SCAN_PHOTOS)
