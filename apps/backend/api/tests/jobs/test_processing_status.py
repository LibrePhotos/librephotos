"""The library processing status (#2741): what each stage has left, and Run now.

``GET /api/library/processing-status/`` counts, per stage that is turned on,
the requester's photos (faces for the face recognition data) the stage's job
still has to do, with the same selection that job uses.
``POST /api/library/processing-status/run/`` starts that job.
"""

from datetime import timedelta
from unittest.mock import patch

from constance.test import override_config
from django.db import connection
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from api.directory_watcher import processing_jobs as pj
from api.directory_watcher.scan_jobs import scan_photos
from api.faces.classify import cluster_all_faces
from api.jobs.processing_status import STAGE_KEYS, processing_status
from api.models import Face, LongRunningJob, Photo
from api.search.embedding_jobs import (
    batch_calculate_clip_embedding,
    photos_missing_clip_embeddings,
)
from api.search.semantic import OPENCLIP
from api.tests.utils import (
    TEST_MEDIA_ROOT,
    api_error,
    create_test_face,
    create_test_job,
    create_test_photo,
    create_test_photo_ocr,
    create_test_user,
)

J = LongRunningJob
URL = "/api/library/processing-status/"
RUN_URL = "/api/library/processing-status/run/"
OCR = "ppocrv6_small"
CAPTIONER = "lfm2_vl_450m"
EVERYTHING_ON = {"OCR_MODEL": OCR, "CAPTIONING_MODEL": CAPTIONER}


def _done_photo(user, **kwargs):
    """A photo every stage is done with."""
    photo = create_test_photo(
        owner=user,
        captions_json={OPENCLIP: {"tags": ["beach"]}, "im2txt": "A beach"},
        **kwargs,
    )
    Photo.objects.filter(pk=photo.pk).update(
        clip_embeddings=[0.1, 0.2],
        clip_embeddings_model=OPENCLIP,
        faces_scanned_at=timezone.now(),
    )
    create_test_photo_ocr(photo, engine=OCR)
    return photo


def _face_without_encoding(photo):
    face = create_test_face(photo=photo)
    Face.objects.filter(pk=face.pk).update(encoding="")
    return face


def _stages(body):
    return {stage["key"]: stage for stage in body["stages"]}


def _remaining(body):
    return {key: stage["remaining"] for key, stage in _stages(body).items()}


@override_config(**EVERYTHING_ON)
class ProcessingStatusCountsTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.done = _done_photo(self.user)
        # No big thumbnail: thumbnails, face detection (no Thumbnail file is
        # still a row), and text and captions, which need the thumbnail.
        self.no_thumbnail = _done_photo(self.user, thumbnail_big="")
        # Never processed at all.
        self.fresh = create_test_photo(owner=self.user)
        # A position whose place was never looked up, and one that was.
        _done_photo(self.user, exif_gps_lat=52.5, exif_gps_lon=13.4)
        Photo.objects.filter(pk=_done_photo(self.user).pk).update(
            exif_gps_lat=48.1, exif_gps_lon=11.6, geocoded_lat=48.1, geocoded_lon=11.6
        )
        # A video: no text and no caption needed.
        video = create_test_photo(owner=self.user, video=True)
        Photo.objects.filter(pk=video.pk).update(faces_scanned_at=timezone.now())
        # An embedding of an earlier model needs a new one.
        Photo.objects.filter(pk=_done_photo(self.user).pk).update(
            clip_embeddings_model="mobileclip_s2"
        )
        # Text of another engine is read again; three failures are given up.
        other_engine = _done_photo(self.user)
        other_engine.ocr.engine = "ppocrv5_mobile"
        other_engine.ocr.save()
        Photo.objects.filter(pk=_done_photo(self.user).pk).update(ocr_failures=3)
        # Faces: one without recognition data, one with.
        _face_without_encoding(self.done)
        create_test_face(photo=self.done)
        # Neither a photo whose file is gone nor one in the trash counts,
        # nor the faces on them.
        _face_without_encoding(create_test_photo(owner=self.user, removed=True))
        create_test_photo(owner=self.user, in_trashcan=True, thumbnail_big="")
        # Someone else's library never counts.
        stranger = create_test_user()
        create_test_photo(owner=stranger, thumbnail_big="")
        _face_without_encoding(create_test_photo(owner=stranger))

    def status(self):
        response = self.client.get(URL)
        self.assertEqual(200, response.status_code, response.content)
        return response.json()

    def test_each_stage_counts_what_is_left(self):
        body = self.status()

        self.assertEqual(9, body["photo_count"])
        self.assertEqual(
            {
                "thumbnails": 1,
                # fresh and the video
                "things": 2,
                # fresh, the video, the earlier model's
                "search": 3,
                "places": 1,
                # fresh (no_thumbnail has a Thumbnail row)
                "face_detection": 1,
                "face_recognition": 1,
                # fresh and the other engine's
                "text": 2,
                "captions": 1,
            },
            _remaining(body),
        )

    def test_counts_match_what_each_job_selects(self):
        """In the library: the jobs also take trashed photos and those whose file is gone."""
        user = self.user
        shown = {"in_trashcan": False, "removed": False}
        selections = {
            "things": pj.photos_to_tag(user, False).filter(**shown),
            "search": photos_missing_clip_embeddings(user).filter(**shown),
            "face_detection": pj._faces_to_scan(user, False).filter(**shown),
            "face_recognition": pj.faces_missing_encoding(user).filter(
                photo__in_trashcan=False, photo__removed=False
            ),
            "text": pj.photos_needing_ocr(user, OCR).filter(**shown),
            "captions": pj.photos_to_caption(user, False).filter(**shown),
        }

        remaining = _remaining(self.status())

        for key, selection in selections.items():
            with self.subTest(key):
                self.assertEqual(selection.count(), remaining[key])

    def test_stages_come_in_pipeline_order(self):
        self.assertEqual(
            list(STAGE_KEYS), [stage["key"] for stage in self.status()["stages"]]
        )

    @override_config(
        SCENE_CLASSIFICATION_ENABLED=False,
        REVERSE_GEOCODING_ENABLED=False,
        FACE_DETECTION_ENABLED=False,
        OCR_MODEL="None",
        CAPTIONING_MODEL="none",
    )
    def test_stages_that_are_off_are_left_out(self):
        self.assertEqual(
            ["thumbnails", "search"],
            [stage["key"] for stage in self.status()["stages"]],
        )

    @override_settings(FEATURE_IMAGE_CAPTIONING=False)
    def test_captions_need_the_feature_too(self):
        self.assertNotIn("captions", _stages(self.status()))

    def test_query_count_does_not_grow_with_the_library(self):
        def queries():
            with CaptureQueriesContext(connection) as context:
                self.status()
            return len(context.captured_queries)

        self.status()  # the site switches are cached from here on
        before = queries()
        for _ in range(6):
            _face_without_encoding(create_test_photo(owner=self.user))
            create_test_job(self.user, J.JOB_GENERATE_TAGS, finished=True)

        self.assertEqual(before, queries())


class ProcessingStatusJobsTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        create_test_photo(owner=self.user)

    def stage(self, key, user=None):
        return _stages(processing_status(user or self.user))[key]

    def test_a_running_job_shows_its_progress(self):
        job = create_test_job(
            self.user, J.JOB_GENERATE_TAGS, progress_current=4, progress_target=9
        )

        self.assertEqual(
            {"job_id": job.job_id, "progress_current": 4, "progress_target": 9},
            self.stage("things")["running_job"],
        )
        self.assertIsNone(self.stage("search")["running_job"])

    def test_the_newest_finished_run_reports_its_failures(self):
        now = timezone.now()
        create_test_job(
            self.user,
            J.JOB_SCAN_FACES,
            finished=True,
            finished_at=now - timedelta(days=1),
            result={"error_count": 40},
        )
        newest = create_test_job(
            self.user,
            J.JOB_SCAN_FACES,
            finished=True,
            failed=True,
            finished_at=now,
            result={"error_count": 3, "status": "failed"},
        )

        self.assertEqual(
            {
                "job_id": newest.job_id,
                "finished_at": now,
                "failed": True,
                "error_count": 3,
            },
            self.stage("face_detection")["last_run"],
        )

    def test_a_run_without_an_error_count_reports_none(self):
        create_test_job(
            self.user, J.JOB_ADD_GEOLOCATION, finished=True, result={"status": "ok"}
        )

        self.assertEqual(0, self.stage("places")["last_run"]["error_count"])

    def test_another_users_jobs_never_show(self):
        create_test_job(create_test_user(), J.JOB_GENERATE_TAGS)
        create_test_job(create_test_user(), J.JOB_GENERATE_TAGS, finished=True)

        stage = self.stage("things")
        self.assertIsNone(stage["running_job"])
        self.assertIsNone(stage["last_run"])

    def test_anonymous_callers_are_refused(self):
        self.assertEqual(401, APIClient().get(URL).status_code)


@override_config(**EVERYTHING_ON)
@patch("api.jobs.processing_status.missing_models_prerequisites", return_value=[])
@patch("api.jobs.processing_status.captioning_model_prerequisites", return_value=[])
class RunProcessingStageTest(TestCase):
    def setUp(self):
        self.user = create_test_user(scan_directory=TEST_MEDIA_ROOT)
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def run_stage(self, stage):
        with (
            patch("api.jobs.queue.AsyncTask") as async_task,
            patch("api.jobs.queue.Chain") as chain,
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = self.client.post(RUN_URL, {"stage": stage}, format="json")
        self.async_task = async_task
        self.chain = chain
        return response

    def assert_started(self, stage, job_type, func):
        response = self.run_stage(stage)

        self.assertEqual(200, response.status_code, response.content)
        job = J.objects.get(job_id=response.json()["job_id"])
        self.assertEqual((job_type, self.user), (job.job_type, job.started_by))
        self.assertEqual((func, self.user), self.async_task.call_args.args[:2])
        return self.async_task.call_args

    def test_each_stage_starts_its_incremental_job(self, *_):
        cases = [
            ("things", J.JOB_GENERATE_TAGS, pj.generate_tags),
            ("search", J.JOB_CALCULATE_CLIP_EMBEDDINGS, batch_calculate_clip_embedding),
            ("places", J.JOB_ADD_GEOLOCATION, pj.add_geolocation),
            ("face_detection", J.JOB_SCAN_FACES, pj.scan_faces),
            ("text", J.JOB_GENERATE_OCR, pj.generate_ocr),
            ("captions", J.JOB_GENERATE_CAPTIONS, pj.generate_captions),
        ]
        for stage, job_type, func in cases:
            with self.subTest(stage):
                call = self.assert_started(stage, job_type, func)
                self.assertNotIn("full_scan", call.kwargs)
                J.objects.all().delete()

    def test_thumbnails_rescan_the_files_of_the_photos_without_one(self, *_):
        missing = create_test_photo(owner=self.user, thumbnail_big="")
        create_test_photo(owner=self.user)

        call = self.assert_started("thumbnails", J.JOB_SCAN_PHOTOS, scan_photos)

        self.assertEqual((self.user, False), call.args[1:])
        self.assertEqual([missing.main_file.path], call.kwargs["scan_files"])
        self.assertIs(True, call.kwargs["force_files"])

    def test_thumbnails_without_a_file_to_read_is_a_400(self, *_):
        response = self.run_stage("thumbnails")

        self.assertEqual(400, response.status_code)
        self.assertEqual("no_files_to_scan", api_error(response)["code"])
        self.assertFalse(J.objects.exists())

    def test_face_recognition_encodes_then_groups(self, *_):
        response = self.run_stage("face_recognition")

        self.assertEqual(200, response.status_code, response.content)
        appended = [
            call.args[0] for call in self.chain.return_value.append.call_args_list
        ]
        self.assertEqual([pj.generate_face_embeddings, cluster_all_faces], appended)

    @override_config(FACE_CLUSTER_ENABLED=False)
    def test_face_recognition_without_grouping_only_encodes(self, *_):
        call = self.assert_started(
            "face_recognition",
            J.JOB_GENERATE_FACE_EMBEDDINGS,
            pj.generate_face_embeddings,
        )

        self.assertEqual((pj.generate_face_embeddings, self.user), call.args)

    @override_config(SCENE_CLASSIFICATION_ENABLED=False)
    def test_a_stage_that_is_off_is_a_403(self, *_):
        response = self.run_stage("things")

        self.assertEqual(403, response.status_code)
        self.assertEqual("stage_off", api_error(response)["code"])
        self.assertFalse(J.objects.exists())

    def test_a_second_start_while_one_runs_is_a_409(self, *_):
        running = create_test_job(self.user, J.JOB_ADD_GEOLOCATION)

        response = self.run_stage("places")

        self.assertEqual(409, response.status_code)
        self.assertEqual("job_already_running", api_error(response)["code"])
        self.assertEqual(running.job_id, response.json()["errors"][0]["job_id"])

    def test_an_unknown_stage_is_a_400(self, *_):
        response = self.run_stage("everything")

        self.assertEqual(400, response.status_code)
        self.assertEqual("stage", api_error(response)["field"])
