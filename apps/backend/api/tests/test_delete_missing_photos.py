from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.autoalbum import delete_missing_photos
from api.tests.utils import create_test_user


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
