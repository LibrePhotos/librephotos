import datetime
import importlib

from django.apps import apps as global_apps
from django.test import TestCase
from django.utils import timezone

from api.models import LongRunningJob
from api.tests.utils import create_test_job, create_test_user

# The module name starts with a digit, so a plain import cannot load it.
migration = importlib.import_module("api.migrations.0230_job_outcome_repair")


class JobOutcomeRepairMigrationTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.now = timezone.now()

    def test_a_cancelled_job_is_not_also_failed(self) -> None:
        job = create_test_job(
            self.user,
            started_at=self.now,
            finished=True,
            finished_at=self.now,
            cancelled=True,
            failed=True,
        )

        migration.repair_outcomes(global_apps, None)

        row = LongRunningJob.objects.get(pk=job.pk)
        self.assertTrue(row.cancelled)
        self.assertFalse(row.failed)

    def test_a_job_that_ended_while_queued_started_when_it_ended(self) -> None:
        ended = self.now - datetime.timedelta(hours=1)
        job = create_test_job(
            self.user, finished=True, finished_at=ended, cancelled=True
        )
        queued = create_test_job(self.user)

        migration.repair_outcomes(global_apps, None)

        self.assertEqual(LongRunningJob.objects.get(pk=job.pk).started_at, ended)
        self.assertIsNone(LongRunningJob.objects.get(pk=queued.pk).started_at)
