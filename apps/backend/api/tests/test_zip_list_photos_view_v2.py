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


class ZipListPhotosV2SelectAllTest(TestCase):
    """The download endpoint also accepts the select_all + query payload
    shape that the other bulk mutations (favorite/hide/public/delete)
    already support, so that the frontend can offer Download when the
    user has done a server-side "Select All" without enumerating every
    image hash. The async zip task isn't exercised in these tests; we
    inspect the photo set handed to create_download_job instead."""

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.other_user = create_test_user()
        self.client.force_authenticate(user=self.user)

        disk_patcher = patch("shutil.disk_usage")
        patched_disk = disk_patcher.start()
        patched_disk.return_value.free = 500000000
        self.addCleanup(disk_patcher.stop)

        # create_download_job enqueues a django-q AsyncTask; stub it out and
        # capture the photos that would have been zipped instead.
        job_patcher = patch("api.views.views.create_download_job")
        self.mock_create_job = job_patcher.start()
        self.mock_create_job.return_value = "fake-job-id"
        self.addCleanup(job_patcher.stop)

    def _queued_hashes(self):
        self.assertTrue(
            self.mock_create_job.called,
            msg="create_download_job was never reached — the view returned early",
        )
        photos = self.mock_create_job.call_args.kwargs["photos"]
        return {photo.image_hash for photo in photos}

    def test_select_all_with_empty_query_includes_all_user_photos(self):
        photos = create_test_photos(number_of_photos=3, owner=self.user, size=100)

        response = self.client.post(
            "/api/photos/download",
            data={"select_all": True, "query": {}},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._queued_hashes(), {p.image_hash for p in photos})

    def test_select_all_only_includes_requesting_users_photos(self):
        mine = create_test_photos(number_of_photos=2, owner=self.user, size=100)
        create_test_photos(number_of_photos=2, owner=self.other_user, size=100)

        response = self.client.post(
            "/api/photos/download",
            data={"select_all": True, "query": {}},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._queued_hashes(), {p.image_hash for p in mine})

    def test_select_all_respects_excluded_hashes(self):
        photos = create_test_photos(number_of_photos=4, owner=self.user, size=100)
        excluded = [photos[0].image_hash, photos[1].image_hash]

        response = self.client.post(
            "/api/photos/download",
            data={
                "select_all": True,
                "query": {},
                "excluded_hashes": excluded,
            },
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._queued_hashes(), {p.image_hash for p in photos[2:]})

    def test_select_all_applies_query_filters(self):
        videos = create_test_photos(
            number_of_photos=2, owner=self.user, size=100, video=True
        )
        create_test_photos(number_of_photos=3, owner=self.user, size=100, video=False)

        response = self.client.post(
            "/api/photos/download",
            data={"select_all": True, "query": {"video": True}},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(self._queued_hashes(), {p.image_hash for p in videos})

    def test_select_all_with_no_matching_photos_returns_404(self):
        # Two videos in the library, but the user's filter says photos-only.
        create_test_photos(number_of_photos=2, owner=self.user, size=100, video=True)

        response = self.client.post(
            "/api/photos/download",
            data={"select_all": True, "query": {"photo": True}},
            format="json",
        )

        self.assertEqual(response.status_code, 404)
        self.assertFalse(self.mock_create_job.called)

    def test_select_all_with_everything_excluded_returns_404(self):
        photos = create_test_photos(number_of_photos=2, owner=self.user, size=100)

        response = self.client.post(
            "/api/photos/download",
            data={
                "select_all": True,
                "query": {},
                "excluded_hashes": [p.image_hash for p in photos],
            },
            format="json",
        )

        self.assertEqual(response.status_code, 404)
        self.assertFalse(self.mock_create_job.called)

    def test_missing_image_hashes_still_rejected_when_select_all_falsy(self):
        # Without select_all the original contract is preserved.
        response = self.client.post(
            "/api/photos/download", data={"select_all": False}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertFalse(self.mock_create_job.called)

    def test_storage_check_runs_in_select_all_mode(self):
        # If free storage is smaller than the aggregated photo size, the
        # endpoint returns 507 regardless of which payload shape was used.
        create_test_photos(number_of_photos=2, owner=self.user, size=10**9)

        with patch("shutil.disk_usage") as patched_disk:
            patched_disk.return_value.free = 0
            response = self.client.post(
                "/api/photos/download",
                data={"select_all": True, "query": {}},
                format="json",
            )

        self.assertEqual(response.status_code, 507)
        self.assertFalse(self.mock_create_job.called)
