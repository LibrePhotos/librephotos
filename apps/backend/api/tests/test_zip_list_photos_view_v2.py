from unittest.mock import patch

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.models.long_running_job import LongRunningJob
from api.tests.utils import create_test_photos, create_test_user


class PhotoListWithoutTimestampTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)

    @patch("shutil.disk_usage")
    def test_download(self, patched_shutil):
        # test download function when we have enough storage
        patched_shutil.return_value.free = 500000000
        now = timezone.now()
        create_test_photos(number_of_photos=1, owner=self.user, added_on=now, size=100)

        response = self.client.get("/api/photos/notimestamp/")
        img_hash = response.json()["results"][0]["url"]
        datadict = {"owner": self.user, "image_hashes": [img_hash]}

        response_2 = self.client.post("/api/photos/download", data=datadict)
        lrr_job = LongRunningJob.objects.all()[0]
        self.assertEqual(lrr_job.job_id, response_2.json()["job_id"])
        self.assertEqual(response_2.status_code, 200)

        # test download function when we dont have enough storage
        patched_shutil.return_value.free = 0
        response_3 = self.client.post("/api/photos/download", data=datadict)
        self.assertEqual(response_3.status_code, 507)
