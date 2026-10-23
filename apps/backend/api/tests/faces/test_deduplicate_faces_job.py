"""Face deduplication without the Django admin (#2030).

``manage.py deduplicate_faces [--user NAME] [--chunk-size N]`` and the
Admin Area job (``POST /api/deduplicate-faces/``, admins only) run the same
``deduplicate_faces`` the admin's "Deduplicate faces" action runs on selected
photos: two overlapping faces of one photo are one face, the labelled one
stays.
"""

from io import StringIO
from unittest import mock

from django.core.management import CommandError, call_command
from django.test import TestCase
from rest_framework.test import APIClient

from api.faces import deduplicate
from api.faces.deduplicate import deduplicate_faces, deduplicate_faces_job
from api.models import Face, LongRunningJob, Person, Photo, User
from api.models.long_running_job import JobCancelledError
from api.tests.utils import (
    api_error,
    create_test_face,
    create_test_job,
    create_test_person,
    create_test_photo,
    create_test_user,
)

URL = "/api/deduplicate-faces/"
BOX = {
    "location_top": 100,
    "location_right": 300,
    "location_bottom": 300,
    "location_left": 100,
}
NEAR_BOX = {
    "location_top": 110,
    "location_right": 310,
    "location_bottom": 310,
    "location_left": 110,
}


def face_count(person: Person) -> int:
    person.refresh_from_db()
    return person.face_count


def photo_with_duplicate(owner: User, **second: object) -> Photo:
    """A photo with two overlapping faces; ``second`` goes to the newer one."""
    photo = create_test_photo(owner=owner)
    create_test_face(photo=photo, **BOX)
    create_test_face(photo=photo, **NEAR_BOX, **second)
    return photo


class DeduplicateFacesTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.other = create_test_user()

    def test_one_user_leaves_the_others_alone(self) -> None:
        mine = photo_with_duplicate(self.user)
        theirs = photo_with_duplicate(self.other)

        result = deduplicate_faces(self.user)

        self.assertEqual((1, 1), (result.photos, result.deleted))
        self.assertEqual(1, mine.faces.count())
        self.assertEqual(2, theirs.faces.count())

    def test_without_a_user_every_photo_is_cleaned(self) -> None:
        photos = [photo_with_duplicate(self.user), photo_with_duplicate(self.other)]
        # A photo with one face has nothing to compare.
        create_test_face(photo=create_test_photo(owner=self.user), **BOX)

        result = deduplicate_faces()

        self.assertEqual((2, 2), (result.photos, result.deleted))
        self.assertEqual([1, 1], [photo.faces.count() for photo in photos])

    def test_progress_is_reported_after_each_chunk(self) -> None:
        for _ in range(3):
            photo_with_duplicate(self.user)
        progress = mock.Mock()

        deduplicate_faces(chunk_size=2, progress=progress)

        self.assertEqual([mock.call(2, 3), mock.call(3, 3)], progress.call_args_list)

    def test_the_person_who_lost_a_face_is_counted_again(self) -> None:
        anna = create_test_person(name="Anna", cluster_owner=self.user)
        photo = create_test_photo(owner=self.user)
        kept = create_test_face(photo=photo, person=anna, **BOX)
        create_test_face(photo=photo, person=anna, **NEAR_BOX)
        anna._calculate_face_count()
        self.assertEqual(2, face_count(anna))

        deduplicate_faces(self.user)

        self.assertEqual([kept.pk], list(photo.faces.values_list("pk", flat=True)))
        self.assertEqual(1, face_count(anna))


class DeduplicateFacesCommandTest(TestCase):
    def call(self, *args: str) -> str:
        out = StringIO()
        call_command("deduplicate_faces", *args, stdout=out)
        return out.getvalue()

    def test_the_command_cleans_one_users_photos(self) -> None:
        user = create_test_user()
        mine = photo_with_duplicate(user)
        theirs = photo_with_duplicate(create_test_user())

        output = self.call("--user", user.username, "--chunk-size", "1")

        self.assertIn("Deleted 1 duplicate face(s) on 1 photo(s)", output)
        self.assertIn("1/1 photos checked", output)
        self.assertEqual((1, 2), (mine.faces.count(), theirs.faces.count()))

    def test_an_unknown_user_is_an_error(self) -> None:
        with self.assertRaises(CommandError):
            self.call("--user", "nobody-by-this-name")

    def test_a_chunk_size_below_one_is_an_error(self) -> None:
        with self.assertRaises(CommandError):
            self.call("--chunk-size", "0")


class DeduplicateFacesJobTest(TestCase):
    def setUp(self) -> None:
        self.admin = create_test_user(is_admin=True)

    def job(self) -> LongRunningJob:
        return create_test_job(self.admin, LongRunningJob.JOB_DEDUPLICATE_FACES)

    def test_the_job_cleans_every_users_photos_and_completes(self) -> None:
        photo = photo_with_duplicate(create_test_user())
        job = self.job()

        self.assertTrue(deduplicate_faces_job(self.admin, job.job_id))

        job.refresh_from_db()
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual({"photos": 1, "deleted": 1}, job.result)
        self.assertEqual(1, photo.faces.count())

    def test_a_job_cancelled_while_queued_does_nothing(self) -> None:
        photo = photo_with_duplicate(create_test_user())
        job = self.job()
        LongRunningJob.objects.filter(pk=job.pk).update(cancelled=True, finished=True)

        self.assertFalse(deduplicate_faces_job(self.admin, job.job_id))
        self.assertEqual(2, photo.faces.count())

    def test_a_cancel_stops_it_between_chunks(self) -> None:
        job = self.job()
        photo_with_duplicate(create_test_user())

        with mock.patch.object(
            LongRunningJob,
            "stop_if_cancelled",
            side_effect=JobCancelledError(str(job.job_id)),
        ):
            self.assertFalse(deduplicate_faces_job(self.admin, job.job_id))

        job.refresh_from_db()
        self.assertFalse(job.failed)

    def test_a_failure_fails_the_job(self) -> None:
        job = self.job()

        with mock.patch.object(
            deduplicate, "deduplicate_faces", side_effect=RuntimeError("boom")
        ):
            self.assertFalse(deduplicate_faces_job(self.admin, job.job_id))

        job.refresh_from_db()
        self.assertTrue(job.failed)


class DeduplicateFacesViewTest(TestCase):
    def setUp(self) -> None:
        self.client = APIClient()

    def test_an_admin_starts_the_job(self) -> None:
        admin = create_test_user(is_admin=True)
        self.client.force_authenticate(user=admin)
        with (
            mock.patch("api.jobs.queue.AsyncTask") as async_task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = self.client.post(URL)

        self.assertEqual(200, response.status_code)
        job = LongRunningJob.objects.get(job_id=response.json()["job_id"])
        self.assertEqual(LongRunningJob.JOB_DEDUPLICATE_FACES, job.job_type)
        self.assertEqual(admin, job.started_by)
        self.assertEqual((deduplicate_faces_job, admin), async_task.call_args.args)

    def test_a_second_start_while_it_runs_is_refused(self) -> None:
        admin = create_test_user(is_admin=True)
        create_test_job(admin, LongRunningJob.JOB_DEDUPLICATE_FACES)
        self.client.force_authenticate(user=admin)

        with mock.patch("api.jobs.queue.AsyncTask") as async_task:
            response = self.client.post(URL)

        self.assertEqual(409, response.status_code)
        self.assertEqual("job_already_running", api_error(response)["code"])
        async_task.assert_not_called()

    def test_a_normal_user_may_not_start_it(self) -> None:
        photo = photo_with_duplicate(create_test_user())
        self.client.force_authenticate(user=create_test_user())

        with mock.patch("api.jobs.queue.AsyncTask") as async_task:
            response = self.client.post(URL)

        self.assertEqual(403, response.status_code)
        async_task.assert_not_called()
        self.assertEqual(2, Face.objects.filter(photo=photo).count())
