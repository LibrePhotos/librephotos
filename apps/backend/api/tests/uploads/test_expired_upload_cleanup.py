"""Expired chunked uploads are removed on a daily schedule (#2204).

A cancelled or abandoned web upload leaves a staged ``.part`` file and its
row; ``chunked_upload.cleanup.delete_expired_uploads`` removes both once the
upload is older than ``CHUNKED_UPLOAD_EXPIRATION_DELTA``, and
``start_job_cleanup_service`` schedules it.
"""

import io
import os
import shutil
import tempfile
from datetime import timedelta
from unittest.mock import patch

from django.core.files.base import ContentFile
from django.core.management import call_command
from django.test import TestCase, override_settings
from django.utils import timezone
from django_q.models import Schedule

from api.tests.utils import create_test_user
from chunked_upload.cleanup import delete_expired_uploads
from chunked_upload.constants import COMPLETE, UPLOADING
from chunked_upload.models import ChunkedUpload

CLEANUP_FUNC = "chunked_upload.cleanup.delete_expired_uploads"


class ExpiredUploadCleanupTest(TestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls._media_root = tempfile.mkdtemp(prefix="expired-uploads-")
        cls._media_override = override_settings(MEDIA_ROOT=cls._media_root)
        cls._media_override.enable()

    @classmethod
    def tearDownClass(cls):
        cls._media_override.disable()
        shutil.rmtree(cls._media_root, ignore_errors=True)
        super().tearDownClass()

    def setUp(self):
        self.user = create_test_user()

    def make_upload(self, *, age: timedelta, status: int = UPLOADING) -> ChunkedUpload:
        upload = ChunkedUpload(user=self.user, filename="photo.jpg", status=status)
        upload.file.save(name="tmp", content=ContentFile(b"partial"), save=False)
        upload.save()
        ChunkedUpload.objects.filter(pk=upload.pk).update(
            created_on=timezone.now() - age
        )
        return upload

    def test_deletes_expired_uploads_and_their_files(self):
        stale = self.make_upload(age=timedelta(days=2))
        stale_done = self.make_upload(age=timedelta(days=3), status=COMPLETE)
        fresh = self.make_upload(age=timedelta(hours=1))

        count = delete_expired_uploads()

        self.assertEqual(count, {UPLOADING: 1, COMPLETE: 1})
        self.assertEqual(list(ChunkedUpload.objects.all()), [fresh])
        self.assertFalse(os.path.exists(stale.file.path))
        self.assertFalse(os.path.exists(stale_done.file.path))
        self.assertTrue(os.path.exists(fresh.file.path))

    def test_keeps_uploads_the_confirm_callback_declines(self):
        stale = self.make_upload(age=timedelta(days=2))

        count = delete_expired_uploads(lambda upload: False)

        self.assertEqual(count, {UPLOADING: 0, COMPLETE: 0})
        self.assertTrue(ChunkedUpload.objects.filter(pk=stale.pk).exists())

    def test_command_reports_what_it_deleted(self):
        self.make_upload(age=timedelta(days=2))
        out = io.StringIO()

        call_command("delete_expired_uploads", stdout=out)

        self.assertIn("0 complete uploads were deleted.", out.getvalue())
        self.assertIn("1 incomplete uploads were deleted.", out.getvalue())
        self.assertFalse(ChunkedUpload.objects.exists())

    def test_interactive_command_asks_before_each_deletion(self):
        kept = self.make_upload(age=timedelta(days=2))
        removed = self.make_upload(age=timedelta(days=3))
        answers = {kept.upload_id: ["maybe", "n"], removed.upload_id: ["y"]}

        def answer(prompt: str) -> str:
            upload_id = next(key for key in answers if key in prompt)
            return answers[upload_id].pop(0)

        with patch("builtins.input", side_effect=answer):
            call_command(
                "delete_expired_uploads", interactive=True, stdout=io.StringIO()
            )

        self.assertEqual(list(ChunkedUpload.objects.all()), [kept])
        self.assertEqual(answers, {kept.upload_id: [], removed.upload_id: []})


class StartJobCleanupServiceScheduleTest(TestCase):
    def test_schedules_the_upload_cleanup_daily_once(self):
        call_command("start_job_cleanup_service")
        call_command("start_job_cleanup_service")

        # get() fails on a missing or duplicated schedule.
        schedule = Schedule.objects.get(func=CLEANUP_FUNC)
        self.assertEqual(schedule.schedule_type, Schedule.DAILY)
