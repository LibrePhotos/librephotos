"""Authorization regression tests for the findings in issue #1861.

1. AlbumUserViewSet ?public must be read-only (no anonymous/cross-user writes).
2. LongRunningJobViewSet must scope jobs to their owner.
3. UserViewSet must not leak other users' private profile fields.
"""

import logging
import uuid

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import AlbumUser, LongRunningJob
from api.models.album_user_share import AlbumUserShare
from api.tests.utils import create_test_user

logger = logging.getLogger(__name__)


def _results(response):
    data = response.json()
    if isinstance(data, dict) and "results" in data:
        return data["results"]
    return data


class PublicAlbumWriteProtectionTest(TestCase):
    """Finding 1: ?public grants read-only access, never write/destroy."""

    def setUp(self):
        self.owner = create_test_user()
        self.attacker = create_test_user()
        self.album = AlbumUser.objects.create(title="Holiday", owner=self.owner)
        AlbumUserShare.objects.create(album=self.album, enabled=True)
        self.url = f"/api/albums/user/{self.album.id}/?public=1"

    def test_public_album_still_readable_anonymously(self):
        # The legitimate read path must keep working.
        resp = APIClient().get(self.url)
        self.assertEqual(resp.status_code, 200)

    def test_anonymous_cannot_delete_public_album(self):
        resp = APIClient().delete(self.url)
        self.assertIn(resp.status_code, (401, 403))
        self.assertTrue(AlbumUser.objects.filter(id=self.album.id).exists())

    def test_other_authenticated_user_cannot_delete_public_album(self):
        client = APIClient()
        client.force_authenticate(user=self.attacker)
        resp = client.delete(self.url)
        self.assertIn(resp.status_code, (403, 404))
        self.assertTrue(AlbumUser.objects.filter(id=self.album.id).exists())


class JobScopingTest(TestCase):
    """Finding 2: a user may only see/act on their own jobs (admins excepted)."""

    def setUp(self):
        self.alice = create_test_user()
        self.bob = create_test_user()
        self.admin = create_test_user(is_admin=True)
        self.alice_job = LongRunningJob.objects.create(
            started_by=self.alice,
            job_id=str(uuid.uuid4()),
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
        )
        self.bob_job = LongRunningJob.objects.create(
            started_by=self.bob,
            job_id=str(uuid.uuid4()),
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
        )

    def test_user_only_lists_own_jobs(self):
        client = APIClient()
        client.force_authenticate(user=self.bob)
        ids = {row["id"] for row in _results(client.get("/api/jobs/"))}
        self.assertIn(self.bob_job.id, ids)
        self.assertNotIn(self.alice_job.id, ids)

    def test_user_cannot_retrieve_others_job(self):
        client = APIClient()
        client.force_authenticate(user=self.bob)
        resp = client.get(f"/api/jobs/{self.alice_job.id}/")
        self.assertEqual(resp.status_code, 404)

    def test_user_cannot_cancel_others_job(self):
        client = APIClient()
        client.force_authenticate(user=self.bob)
        resp = client.post(f"/api/jobs/{self.alice_job.id}/cancel/")
        self.assertEqual(resp.status_code, 404)
        self.alice_job.refresh_from_db()
        self.assertFalse(self.alice_job.cancelled)

    def test_admin_sees_all_jobs(self):
        client = APIClient()
        client.force_authenticate(user=self.admin)
        ids = {row["id"] for row in _results(client.get("/api/jobs/"))}
        self.assertIn(self.alice_job.id, ids)
        self.assertIn(self.bob_job.id, ids)


class JobMineParameterTest(TestCase):
    """?mine backs the per-user jobs view (#1909).

    The parameter exists so that "My Jobs" means the caller's own jobs for every
    role, including staff. It may only ever narrow the list: for a non-staff
    caller it must make no difference whatsoever, because their queryset is
    already confined to themselves and no request input may widen it.
    """

    def setUp(self):
        self.alice = create_test_user()
        self.bob = create_test_user()
        self.admin = create_test_user(is_admin=True)
        self.alice_job = LongRunningJob.objects.create(
            started_by=self.alice,
            job_id=str(uuid.uuid4()),
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
        )
        self.admin_job = LongRunningJob.objects.create(
            started_by=self.admin,
            job_id=str(uuid.uuid4()),
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
        )

    def _ids(self, user, query=""):
        client = APIClient()
        client.force_authenticate(user=user)
        return {row["id"] for row in _results(client.get(f"/api/jobs/{query}"))}

    def test_mine_narrows_the_list_for_staff(self):
        self.assertEqual(self._ids(self.admin, "?mine=true"), {self.admin_job.id})

    def test_staff_still_see_everything_without_the_parameter(self):
        ids = self._ids(self.admin)
        self.assertIn(self.alice_job.id, ids)
        self.assertIn(self.admin_job.id, ids)

    def test_staff_mine_false_is_the_global_list(self):
        self.assertIn(self.alice_job.id, self._ids(self.admin, "?mine=false"))

    def test_non_staff_cannot_widen_their_list_with_mine_false(self):
        # The flaw this guards: if ?mine were read before the non-staff scoping,
        # opting out of it would expose every user's jobs.
        for query in ("?mine=false", "?mine=0", "?mine=", "?mine=TRUE", ""):
            with self.subTest(query=query):
                self.assertEqual(
                    self._ids(self.bob, query),
                    set(),
                    "a non-staff caller must never see another user's jobs",
                )

    def test_non_staff_sees_own_jobs_regardless_of_the_parameter(self):
        for query in ("?mine=true", "?mine=false", ""):
            with self.subTest(query=query):
                self.assertEqual(self._ids(self.alice, query), {self.alice_job.id})


class UserProfileExposureTest(TestCase):
    """Finding 3: non-admins must not see other users' private profile fields."""

    SENSITIVE = ("email", "scan_directory", "nextcloud_server_address", "is_superuser")

    def setUp(self):
        self.alice = create_test_user(
            scan_directory="/data/alice-private",
            nextcloud_server_address="https://nc.alice.example",
        )
        self.alice.email = "alice@example.com"
        self.alice.save()
        self.bob = create_test_user()
        self.bob.email = "bob@example.com"
        self.bob.save()
        self.admin = create_test_user(is_admin=True)

    def test_non_admin_list_hides_other_users_private_fields(self):
        client = APIClient()
        client.force_authenticate(user=self.bob)
        rows = {row["id"]: row for row in _results(client.get("/api/user/"))}
        alice_row = rows[self.alice.id]
        for field in self.SENSITIVE:
            self.assertNotIn(field, alice_row)

    def test_non_admin_retrieve_other_user_hides_private_fields(self):
        client = APIClient()
        client.force_authenticate(user=self.bob)
        row = client.get(f"/api/user/{self.alice.id}/").json()
        for field in self.SENSITIVE:
            self.assertNotIn(field, row)

    def test_user_can_see_own_full_profile(self):
        client = APIClient()
        client.force_authenticate(user=self.bob)
        row = client.get(f"/api/user/{self.bob.id}/").json()
        self.assertEqual(row.get("email"), "bob@example.com")

    def test_admin_sees_full_profiles(self):
        client = APIClient()
        client.force_authenticate(user=self.admin)
        rows = {row["id"]: row for row in _results(client.get("/api/user/"))}
        self.assertEqual(rows[self.alice.id].get("email"), "alice@example.com")
