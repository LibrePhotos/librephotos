"""The upload follow-ups: one debounced, leased run per user (#2735).

Uploads got thumbnails, tags, places and faces per photo, but never the
library-level steps of a scan: the similarity index was not rebuilt, photos
got no search embedding with tagging off, and XMP-region faces no encoding.
"""

import ast
import io
from datetime import timedelta
from unittest import mock

from constance.test import override_config
from django.core.management import call_command
from django.db import IntegrityError
from django.test import TestCase
from django.utils import timezone
from django_q.models import Schedule

from api.jobs.queue import schedule_once_by
from api.jobs.upload_followups import (
    DEBOUNCE,
    RUN_FUNC,
    FollowupLease,
    backfill_upload_followups,
    request_upload_followups,
    run_upload_followups,
)
from api.models import UploadFollowupState
from api.search.semantic import OPENCLIP
from api.tests.utils import (
    create_test_photo,
    create_test_upload_followup_state,
    create_test_user,
)

FUNC = "api.jobs.upload_followups.run_upload_followups"


def _schedules(user):
    return Schedule.objects.filter(name=f"upload-followups-{user.id}")


def _state(user):
    return UploadFollowupState.objects.get_owned(user, pk=user.pk)


class ScheduleOnceByTest(TestCase):
    def test_creates_one_named_once_schedule(self):
        at = timezone.now() + timedelta(minutes=2)

        schedule_once_by("job-a", FUNC, 7, at=at)

        schedule = Schedule.objects.get(name="job-a")
        self.assertEqual(Schedule.ONCE, schedule.schedule_type)
        self.assertEqual(at, schedule.next_run)
        self.assertEqual((7,), ast.literal_eval(schedule.args))

    def test_moves_an_existing_schedule_sooner_never_later(self):
        soon = timezone.now() + timedelta(minutes=1)
        later = soon + timedelta(minutes=5)

        schedule_once_by("job-a", FUNC, 7, at=later)
        schedule_once_by("job-a", FUNC, 7, at=soon)
        schedule_once_by("job-a", FUNC, 7, at=later)

        self.assertEqual([soon], [s.next_run for s in Schedule.objects.all()])

    def test_a_concurrent_create_is_not_an_error(self):
        with mock.patch("api.jobs.queue.schedule", side_effect=IntegrityError):
            schedule_once_by("job-a", FUNC, 7, at=timezone.now())

        self.assertFalse(Schedule.objects.exists())


class RequestUploadFollowupsTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_schedules_a_run_with_the_user_id_within_the_debounce(self):
        before = timezone.now()

        request_upload_followups(self.user)

        [schedule] = _schedules(self.user)
        self.assertEqual(RUN_FUNC, schedule.func)
        self.assertEqual((self.user.id,), ast.literal_eval(schedule.args))
        self.assertLessEqual(schedule.next_run, timezone.now() + DEBOUNCE)
        self.assertGreaterEqual(schedule.next_run, before + DEBOUNCE)
        self.assertTrue(_state(self.user).photos_added)

    def test_fifty_requests_make_one_schedule(self):
        for _ in range(50):
            request_upload_followups(self.user)

        self.assertEqual(1, _schedules(self.user).count())

    def test_a_request_while_a_run_holds_the_lease_marks_it_dirty(self):
        lease = FollowupLease.acquire(self.user)
        self.assertIsNotNone(lease)

        request_upload_followups(self.user)

        self.assertFalse(_schedules(self.user).exists())
        self.assertTrue(_state(self.user).dirty)

    def test_an_expired_lease_does_not_swallow_the_request(self):
        create_test_upload_followup_state(
            self.user,
            lease_holder="gone",
            lease_expires_at=timezone.now() - timedelta(seconds=1),
        )

        request_upload_followups(self.user)

        self.assertEqual(1, _schedules(self.user).count())


class FollowupLeaseTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_two_runs_cannot_hold_the_lease_at_once(self):
        first = FollowupLease.acquire(self.user)

        self.assertIsNotNone(first)
        self.assertIsNone(FollowupLease.acquire(self.user))

    def test_an_expired_lease_can_be_taken(self):
        create_test_upload_followup_state(
            self.user,
            lease_holder="gone",
            lease_expires_at=timezone.now() - timedelta(seconds=1),
        )

        self.assertIsNotNone(FollowupLease.acquire(self.user))

    def test_an_expired_holder_cannot_renew(self):
        lease = FollowupLease.acquire(self.user)
        UploadFollowupState.objects.owned_by(self.user).update(
            lease_expires_at=timezone.now() - timedelta(seconds=1)
        )

        self.assertFalse(lease.renew())

    def test_a_holder_whose_lease_was_taken_cannot_renew(self):
        lease = FollowupLease.acquire(self.user)
        UploadFollowupState.objects.owned_by(self.user).update(
            lease_expires_at=timezone.now() - timedelta(seconds=1)
        )
        other = FollowupLease.acquire(self.user)

        self.assertFalse(lease.renew())
        self.assertTrue(other.renew())

    def test_release_frees_the_lease(self):
        lease = FollowupLease.acquire(self.user)

        self.assertTrue(lease.release())

        state = _state(self.user)
        self.assertEqual(("", None), (state.lease_holder, state.lease_expires_at))
        self.assertIsNotNone(FollowupLease.acquire(self.user))

    def test_release_after_a_request_keeps_the_lease_for_one_more_pass(self):
        lease = FollowupLease.acquire(self.user)
        request_upload_followups(self.user)

        self.assertFalse(lease.release())

        self.assertFalse(_state(self.user).dirty)
        self.assertTrue(lease.renew())

    def test_a_lost_lease_schedules_a_run_on_release(self):
        lease = FollowupLease.acquire(self.user)
        UploadFollowupState.objects.owned_by(self.user).update(
            lease_expires_at=timezone.now() - timedelta(seconds=1), dirty=True
        )

        self.assertTrue(lease.release())

        self.assertEqual(1, _schedules(self.user).count())


class RunUploadFollowupsTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.embed = self._patch("batch_calculate_clip_embedding")
        self.index = self._patch("build_image_similarity_index")
        self.encode = self._patch("generate_face_embeddings")
        self.faces_on = self._patch("feature_enabled", return_value=True)

    def _patch(self, name, **kwargs):
        patcher = mock.patch(f"api.jobs.upload_followups.{name}", **kwargs)
        self.addCleanup(patcher.stop)
        return patcher.start()

    def _embedded_photo(self):
        return create_test_photo(
            owner=self.user,
            clip_embeddings=[0.1] * 4,
            clip_embeddings_model=OPENCLIP,
        )

    def test_photos_without_an_embedding_are_embedded_which_rebuilds_the_index(self):
        create_test_photo(owner=self.user)
        request_upload_followups(self.user)

        run_upload_followups(self.user.id)

        self.embed.assert_called_once()
        self.assertEqual(self.user, self.embed.call_args.args[0])
        self.index.assert_not_called()

    def test_with_embeddings_stored_inline_the_index_is_still_rebuilt_once(self):
        self._embedded_photo()
        request_upload_followups(self.user)

        run_upload_followups(self.user.id)

        self.embed.assert_not_called()
        self.index.assert_called_once_with(self.user)
        self.assertFalse(_state(self.user).photos_added)

    def test_nothing_added_and_nothing_missing_rebuilds_nothing(self):
        self._embedded_photo()
        create_test_upload_followup_state(self.user)

        run_upload_followups(self.user.id)

        self.embed.assert_not_called()
        self.index.assert_not_called()

    def test_a_photo_without_a_big_thumbnail_is_left_for_later(self):
        create_test_photo(owner=self.user, thumbnail_big="")
        create_test_upload_followup_state(self.user)

        run_upload_followups(self.user.id)

        self.embed.assert_not_called()

    def test_faces_are_encoded_while_face_detection_is_on(self):
        create_test_upload_followup_state(self.user)

        run_upload_followups(self.user.id)

        self.faces_on.assert_called_with("FACE_DETECTION")
        self.encode.assert_called_once()
        self.assertEqual(self.user, self.encode.call_args.args[0])

    def test_faces_are_left_alone_while_face_detection_is_off(self):
        self.faces_on.return_value = False
        create_test_upload_followup_state(self.user)

        run_upload_followups(self.user.id)

        self.encode.assert_not_called()

    def test_an_upload_during_a_run_causes_exactly_one_more_pass(self):
        self._embedded_photo()
        request_upload_followups(self.user)
        _schedules(self.user).delete()  # the run below is the one it scheduled
        calls = []

        def index(user):
            calls.append(user)
            if len(calls) == 1:
                request_upload_followups(self.user)

        self.index.side_effect = index

        run_upload_followups(self.user.id)

        self.assertEqual(2, len(calls))
        self.assertEqual(2, self.encode.call_count)
        self.assertFalse(_schedules(self.user).exists())
        state = _state(self.user)
        self.assertEqual(("", False), (state.lease_holder, state.dirty))

    def test_the_steps_renew_the_lease_through_the_heartbeat(self):
        create_test_photo(owner=self.user)
        request_upload_followups(self.user)
        seen = []

        def embed(user, heartbeat):
            seen.append(heartbeat())

        self.embed.side_effect = embed

        run_upload_followups(self.user.id)

        self.assertEqual([True], seen)

    def test_a_run_finding_the_lease_held_does_nothing(self):
        FollowupLease.acquire(self.user)
        request_upload_followups(self.user)

        run_upload_followups(self.user.id)

        self.index.assert_not_called()
        self.encode.assert_not_called()

    def test_a_failing_step_does_not_stop_the_others(self):
        self._embedded_photo()
        request_upload_followups(self.user)
        self.index.side_effect = RuntimeError("similarity sidecar down")

        run_upload_followups(self.user.id)

        self.encode.assert_called_once()
        self.assertEqual("", _state(self.user).lease_holder)

    def test_a_run_that_loses_its_lease_stops_and_schedules_the_rest(self):
        self._embedded_photo()
        request_upload_followups(self.user)
        _schedules(self.user).delete()

        def index(user):
            UploadFollowupState.objects.owned_by(self.user).update(
                lease_holder="someone-else"
            )

        self.index.side_effect = index

        run_upload_followups(self.user.id)

        self.encode.assert_not_called()
        self.assertEqual(1, _schedules(self.user).count())

    def test_a_deleted_user_is_skipped(self):
        user_id = self.user.id
        self.user.delete()

        run_upload_followups(user_id)

        self.index.assert_not_called()


class BackfillUploadFollowupsTest(TestCase):
    def setUp(self):
        self.alice = create_test_user()
        self.bob = create_test_user()
        self.carol = create_test_user()
        create_test_photo(owner=self.alice)
        create_test_photo(owner=self.bob)

    @override_config(UPLOAD_FOLLOWUPS_BACKFILL_DONE=False)
    def test_requests_the_follow_ups_once_per_user_with_photos(self):
        self.assertEqual(2, backfill_upload_followups())

        self.assertTrue(_state(self.alice).photos_added)
        self.assertTrue(_state(self.bob).photos_added)
        self.assertFalse(UploadFollowupState.objects.owned_by(self.carol).exists())
        [alice_run] = _schedules(self.alice)
        [bob_run] = _schedules(self.bob)
        self.assertLess(alice_run.next_run, bob_run.next_run)

        self.assertEqual(0, backfill_upload_followups())
        self.assertEqual(1, _schedules(self.alice).count())

    @override_config(UPLOAD_FOLLOWUPS_BACKFILL_DONE=False)
    def test_the_startup_command_runs_it(self):
        out = io.StringIO()
        with mock.patch(
            "api.management.commands.start_upgrade_tasks.start_automatic_tasks",
            return_value=[],
        ):
            call_command("start_upgrade_tasks", stdout=out)

        self.assertIn("upload follow-ups for 2 users", out.getvalue())
        self.assertEqual(1, _schedules(self.bob).count())

    @override_config(UPLOAD_FOLLOWUPS_BACKFILL_DONE=True)
    def test_does_nothing_once_done(self):
        self.assertEqual(0, backfill_upload_followups())

        self.assertFalse(Schedule.objects.exists())


class HeartbeatTest(TestCase):
    """The long steps call the heartbeat inside their loops."""

    def setUp(self):
        self.user = create_test_user()

    def test_the_embedding_job_beats_after_every_batch(self):
        from api.search import embedding_jobs

        for _ in range(3):
            create_test_photo(owner=self.user)
        heartbeat = mock.Mock()
        with (
            mock.patch.object(embedding_jobs, "BATCH_SIZE", 2),
            mock.patch.object(embedding_jobs, "store_clip_embeddings"),
            mock.patch.object(
                embedding_jobs, "photos_with_existing_thumbnail", return_value=[]
            ),
            mock.patch.object(embedding_jobs, "build_image_similarity_index"),
        ):
            embedding_jobs.batch_calculate_clip_embedding(
                self.user, heartbeat=heartbeat
            )

        self.assertEqual(2, heartbeat.call_count)

    def test_the_face_encoding_job_beats_after_every_face(self):
        from api.directory_watcher import processing_jobs
        from api.models import Face
        from api.tests.utils import create_test_face

        photo = create_test_photo(owner=self.user)
        for _ in range(2):
            create_test_face(photo=photo)
        # The factory always gives a face an encoding.
        Face.objects.filter(photo=photo).update(encoding="")
        heartbeat = mock.Mock()
        with mock.patch.object(processing_jobs.photo_faces, "generate_face_encoding"):
            processing_jobs.generate_face_embeddings(self.user, heartbeat=heartbeat)

        self.assertEqual(2, heartbeat.call_count)
