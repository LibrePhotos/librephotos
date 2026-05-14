import uuid
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.autoalbum import delete_missing_photos
from api.models import File, LongRunningJob, Photo
from api.tests.utils import create_test_photo, create_test_user


class DeleteMissingPhotosAsyncTaskTest(TestCase):
    """Guards the AsyncTask wrap in DeleteMissingPhotosView._delete_missing_photos.

    Before this fix the work ran synchronously in the request thread, so libraries
    with many missing photos timed out the gunicorn worker (issues #1405, #672).
    The endpoint must return immediately and hand the work to django-q2.
    """

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    def test_post_queues_async_task_and_returns_immediately(self):
        with patch("api.views.views.AsyncTask") as async_task_cls:
            response = self.client.post("/api/deletemissingphotos/")

        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertTrue(data["status"])
        self.assertIn("job_id", data)

        async_task_cls.assert_called_once()
        args = async_task_cls.call_args.args
        self.assertIs(args[0], delete_missing_photos)
        self.assertEqual(args[1], self.user)
        self.assertEqual(str(args[2]), data["job_id"])
        async_task_cls.return_value.run.assert_called_once_with()


class DeleteMissingPhotosCorrectnessTest(TestCase):
    """Guards three correctness fixes in api.autoalbum.delete_missing_photos.

    The function had a Q-filter precedence bug that scoped only the first OR
    clause to the requesting user, letting a non-admin scan touch other users'
    photos. It also relied on a User instance reaching a CharField lookup, and
    never reported progress to the LongRunningJob it ran under.
    """

    def test_does_not_touch_other_users_missing_photos(self):
        """Cross-user data-leak guard.

        With the original `Q(owner=user) & Q(files=None) | Q(main_file=None)`
        operator precedence, the second clause has no owner restriction, so any
        photo with `main_file=None` would match regardless of who initiated
        the scan. Once parenthesised, the filter is scoped per-user.
        """
        user1 = create_test_user()
        user2 = create_test_user()

        # user1's photo is a candidate for deletion (owner matches, M2M empty).
        photo1 = create_test_photo(owner=user1)
        # user2's photo is NOT a candidate when user1 scans, but it has
        # main_file=None which the buggy second OR clause would match.
        # Populate the M2M so Q(files=None) does not match, isolating the
        # main_file=None branch.
        photo2 = create_test_photo(owner=user2)
        photo2.files.add(photo2.main_file)
        photo2.main_file = None
        photo2.save()

        delete_missing_photos(user1, str(uuid.uuid4()))

        # user1's photo gets cleaned up; user2's must survive.
        self.assertFalse(Photo.objects.filter(pk=photo1.pk).exists())
        self.assertTrue(Photo.objects.filter(pk=photo2.pk).exists())

    def test_missing_files_filtered_by_owning_user_id(self):
        """File.hash is composed as `md5 + str(user.id)`; the user-owned
        subset of missing files is identified by that suffix. Passing the
        User instance directly relied on `str(user)` → username, which
        never matches the hash suffix in practice.
        """
        user = create_test_user()
        other = create_test_user()

        mine = File.objects.create(
            hash=f"deadbeef{user.id}",
            path=f"/tmp/mine-{user.id}.png",
            type=File.IMAGE,
            missing=True,
        )
        theirs = File.objects.create(
            hash=f"deadbeef{other.id}",
            path=f"/tmp/theirs-{other.id}.png",
            type=File.IMAGE,
            missing=True,
        )

        delete_missing_photos(user, str(uuid.uuid4()))

        self.assertFalse(File.objects.filter(pk=mine.pk).exists())
        self.assertTrue(File.objects.filter(pk=theirs.pk).exists())

    def test_reports_progress_to_long_running_job(self):
        """Without per-iteration `lrj.update_progress`, the UI was stuck on
        "running" indefinitely (issue #1405). Both target and current must
        reach the count of processed missing photos.
        """
        user = create_test_user()
        for _ in range(3):
            create_test_photo(owner=user)  # files=None makes them candidates

        job_id = str(uuid.uuid4())
        delete_missing_photos(user, job_id)

        lrj = LongRunningJob.objects.get(job_id=job_id)
        self.assertEqual(lrj.progress_target, 3)
        self.assertEqual(lrj.progress_current, 3)
