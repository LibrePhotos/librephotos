import datetime
import importlib

from django.apps import apps as global_apps
from django.test import TestCase

from api.models import LongRunningJob, Photo, User
from api.tests.utils import create_test_face, create_test_photo, create_test_user

# The module name starts with a digit, so a plain import cannot load it.
migration_0164 = importlib.import_module("api.migrations.0164_photo_faces_scanned_at")

JOB_STARTED = datetime.datetime(2024, 5, 6, 12, 0, tzinfo=datetime.timezone.utc)
BEFORE = JOB_STARTED - datetime.timedelta(days=1)
AFTER = JOB_STARTED + datetime.timedelta(hours=1)


class PhotoFacesScannedAtMigrationTest(TestCase):
    """Which photos of an existing library count as face-scanned (#2199)."""

    def setUp(self) -> None:
        self.user = create_test_user()

    def photo(self, added_on: datetime.datetime, owner: User | None = None) -> Photo:
        photo = create_test_photo(owner=owner or self.user, added_on=added_on)
        Photo.objects.filter(pk=photo.pk).update(faces_scanned_at=None)
        return photo

    def face_job(
        self, user: User | None = None, *, cancelled: bool = False
    ) -> LongRunningJob:
        job = LongRunningJob.create_job(
            user=user or self.user, job_type=LongRunningJob.JOB_SCAN_FACES
        )
        LongRunningJob.objects.filter(pk=job.pk).update(
            started_at=JOB_STARTED,
            finished=True,
            finished_at=AFTER,
            cancelled=cancelled,
        )
        return job

    def scanned_at(self, photo: Photo) -> datetime.datetime | None:
        return Photo.objects.get(pk=photo.pk).faces_scanned_at

    def test_photos_older_than_the_last_face_job_are_scanned(self) -> None:
        self.face_job()
        old = self.photo(BEFORE)
        new = self.photo(AFTER)

        migration_0164.forwards(global_apps, None)

        self.assertEqual(BEFORE, self.scanned_at(old))
        self.assertIsNone(self.scanned_at(new))

    def test_a_cancelled_face_job_is_no_baseline(self) -> None:
        self.face_job(cancelled=True)
        old = self.photo(BEFORE)

        migration_0164.forwards(global_apps, None)

        self.assertIsNone(self.scanned_at(old))

    def test_another_users_face_job_does_not_count(self) -> None:
        self.face_job(create_test_user())
        old = self.photo(BEFORE)

        migration_0164.forwards(global_apps, None)

        self.assertIsNone(self.scanned_at(old))

    def test_a_photo_with_a_face_is_scanned(self) -> None:
        photo = self.photo(AFTER)
        create_test_face(photo=photo)

        migration_0164.forwards(global_apps, None)

        self.assertEqual(AFTER, self.scanned_at(photo))
