"""Faces in a video's later frames, not only its first (#2761).

ffmpeg is never run: ``frames.grab_frame`` is patched to write a picture.
The face sidecar is never called either: ``api.runtime.sidecars.http.post``
answers for the big thumbnail and for each frame the way the real one does.
"""

import json
import os
import re
from unittest.mock import patch

import numpy as np
import requests
from constance.test import override_config
from django.db.models import QuerySet
from django.test import SimpleTestCase, TestCase, override_settings
from PIL import Image

from api.directory_watcher.processing_jobs import faces_missing_encoding
from api.faces import extractor, photo_faces, video_faces
from api.faces.deduplicate import deduplicate_faces_of_photos
from api.faces.photo_faces import extract_faces, restore_missing_crops
from api.faces.video_faces import (
    MAX_FRAMES,
    FrameFace,
    distinct_people,
    frame_times,
    video_seconds,
)
from api.metadata import face_regions
from api.models import Face, Photo, User
from api.runtime import sidecars
from api.tests.utils import create_test_face, create_test_photo, create_test_user
from api.video import frames

WIDTH, HEIGHT = 320, 180
# (top, right, bottom, left)
ANNA_BOX = (20, 120, 100, 40)
ANNA_BIG_BOX = (10, 160, 130, 40)
BEN_BOX = (30, 300, 90, 240)
ANNA = [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
# Anna again, from another angle: cosine 0.8 with ANNA.
ANNA_TURNED = [0.8, 0.6, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
BEN = [0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0]

Detections = list[tuple[tuple[int, int, int, int], list[float]]]


def _answer(detections: Detections) -> requests.Response:
    response = requests.Response()
    response.status_code = 200
    response._content = json.dumps(
        {
            "face_locations": [list(box) for box, _ in detections],
            "encodings": [encoding for _, encoding in detections],
        }
    ).encode()
    response.headers["Content-Type"] = "application/json"
    return response


class _FakeFaceService:
    """Answers /face-locations: ``poster`` for the big thumbnail, ``frames[i]`` for frame i."""

    def __init__(self, poster: Detections, frames: dict[int, Detections]) -> None:
        self.poster = poster
        self.frames = frames
        self.sources: list[str] = []

    def __call__(self, url: str, **kwargs: object) -> requests.Response:
        payload = kwargs["json"]
        assert isinstance(payload, dict)
        source = str(payload["source"])
        self.sources.append(source)
        match = re.search(r"(\d+)-frame\.jpg$", source)
        if match is None:
            return _answer(self.poster)
        return _answer(self.frames.get(int(match.group(1)), []))


def _write_frame(
    input_path: str, seconds: float, output_path: str, transfer: str | None = None
) -> None:
    Image.new("RGB", (WIDTH, HEIGHT), "white").save(output_path)


class FrameTimesTest(SimpleTestCase):
    def test_no_length_or_a_short_video_has_no_frames(self) -> None:
        for seconds in (None, 0.5, 1.99):
            with self.subTest(seconds=seconds):
                self.assertEqual([], frame_times(seconds))

    def test_a_two_second_video_gets_two_frames(self) -> None:
        self.assertEqual([0.1, 1.9], frame_times(2.0))

    def test_a_short_video_gets_one_frame_a_second(self) -> None:
        self.assertEqual([0.25, 1.375, 2.5, 3.625, 4.75], frame_times(5.0))

    def test_a_long_video_gets_eight_frames_from_5_to_95_percent(self) -> None:
        times = frame_times(100.0)

        self.assertEqual(MAX_FRAMES, len(times))
        self.assertEqual(5.0, times[0])
        self.assertEqual(95.0, times[-1])
        for a, b in zip(times, times[1:]):
            self.assertAlmostEqual(90 / 7, b - a, places=2)

    def test_the_stored_length_is_read_as_seconds(self) -> None:
        self.assertEqual(12.5, video_seconds("12.5"))
        for stored in (None, "", "0", "-3", "a minute"):
            with self.subTest(stored=stored):
                self.assertIsNone(video_seconds(stored))


def _candidate(
    seconds: float, box: tuple[int, int, int, int], encoding: list[float]
) -> FrameFace:
    return FrameFace(
        seconds, Image.new("RGB", (4, 4)), box, np.array(encoding, dtype=np.float64)
    )


class DistinctPeopleTest(SimpleTestCase):
    def test_one_person_in_every_frame_is_kept_once(self) -> None:
        candidates = [_candidate(t, ANNA_BOX, ANNA) for t in range(MAX_FRAMES)]

        kept = distinct_people(candidates, [])

        self.assertEqual([0], [face.video_time for face in kept])

    def test_of_one_person_the_biggest_face_is_kept(self) -> None:
        candidates = [
            _candidate(1.0, ANNA_BOX, ANNA),
            _candidate(4.0, ANNA_BIG_BOX, ANNA_TURNED),
        ]

        kept = distinct_people(candidates, [])

        self.assertEqual([4.0], [face.video_time for face in kept])

    def test_two_people_are_both_kept(self) -> None:
        candidates = [_candidate(1.0, ANNA_BOX, ANNA), _candidate(2.0, BEN_BOX, BEN)]

        self.assertEqual(2, len(distinct_people(candidates, [])))

    def test_a_person_the_video_has_a_face_of_is_not_kept(self) -> None:
        candidates = [_candidate(1.0, ANNA_BOX, ANNA_TURNED)]
        poster_anna = np.array(ANNA, dtype=np.float64)

        self.assertEqual([], distinct_people(candidates, [poster_anna]))

    def test_an_encoding_of_another_model_is_never_a_match(self) -> None:
        candidates = [_candidate(1.0, ANNA_BOX, ANNA)]
        other_model = np.ones(16, dtype=np.float64) / 4

        self.assertEqual(1, len(distinct_people(candidates, [other_model])))


@override_settings(FEATURE_FACE_DETECTION=True)
class VideoFrameScanTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.video = self._photo(video=True, video_length="10.0")
        grab = patch.object(frames, "grab_frame", side_effect=_write_frame)
        self.grab_frame = grab.start()
        self.addCleanup(grab.stop)
        regions = patch.object(extractor, "extract_from_exif", return_value=None)
        regions.start()
        self.addCleanup(regions.stop)

    def _photo(self, **kwargs: object) -> Photo:
        photo = create_test_photo(
            owner=self.user, video_color_transfer="bt709", **kwargs
        )
        path = photo.thumbnail.thumbnail_big.path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        Image.new("RGB", (WIDTH, HEIGHT), "white").save(path)
        self.addCleanup(os.remove, path)
        return photo

    def scan(
        self,
        poster: Detections,
        frames_seen: dict[int, Detections],
        photo: Photo | None = None,
    ) -> _FakeFaceService:
        service = _FakeFaceService(poster, frames_seen)
        with patch.object(sidecars.http, "post", side_effect=service):
            extract_faces(Photo.objects.get(pk=(photo or self.video).pk))
        return service

    def faces(self, photo: Photo | None = None) -> QuerySet[Face]:
        return Face.objects.filter(photo=photo or self.video).order_by("id")

    def test_a_person_who_appears_later_gets_a_face_with_its_time(self) -> None:
        self.scan([], {3: [(BEN_BOX, BEN)]})

        (face,) = self.faces()
        times = frame_times(10.0)
        self.assertEqual(times[3], face.video_time)
        self.assertEqual(BEN_BOX[0], face.location_top)
        self.assertTrue(face.image)
        self.assertTrue(face.encoding)
        self.assertEqual(MAX_FRAMES, self.grab_frame.call_count)

    def test_a_person_in_every_frame_gets_one_face(self) -> None:
        self.scan([], {index: [(ANNA_BOX, ANNA)] for index in range(MAX_FRAMES)})

        self.assertEqual(1, self.faces().count())

    def test_a_person_on_the_first_frame_is_not_added_from_the_others(self) -> None:
        self.scan(
            [(ANNA_BOX, ANNA)],
            {index: [(ANNA_BIG_BOX, ANNA_TURNED)] for index in range(MAX_FRAMES)},
        )

        (face,) = self.faces()
        self.assertIsNone(face.video_time)

    def test_rescanning_adds_no_face_again(self) -> None:
        seen = {2: [(ANNA_BOX, ANNA)], 5: [(BEN_BOX, BEN)]}
        self.scan([], seen)
        self.scan([], seen)

        self.assertEqual(2, self.faces().count())

    def test_a_deleted_frame_face_is_not_found_again(self) -> None:
        seen = {2: [(ANNA_BOX, ANNA)]}
        self.scan([], seen)
        self.faces().update(deleted=True)
        self.scan([], seen)

        self.assertEqual(1, self.faces().count())

    def test_a_frame_face_does_not_hide_a_first_frame_face_at_its_place(self) -> None:
        self.scan([], {2: [(ANNA_BOX, ANNA)]})
        self.scan([(ANNA_BOX, BEN)], {})

        self.assertEqual(2, self.faces().count())

    def test_a_face_below_the_minimum_size_is_skipped(self) -> None:
        # 180 px high: 50 % is 90 px, more than Ben's 60 px.
        User.objects.filter(pk=self.user.pk).update(min_face_size=0.5)
        self.scan([], {1: [(BEN_BOX, BEN)]})

        self.assertEqual(0, self.faces().count())

    def test_a_frame_ffmpeg_cannot_grab_is_skipped(self) -> None:
        def fail_on_first(
            input_path: str, seconds: float, output_path: str, transfer: str | None
        ) -> None:
            if seconds == frame_times(10.0)[0]:
                raise frames.FrameError("broken")
            _write_frame(input_path, seconds, output_path, transfer)

        self.grab_frame.side_effect = fail_on_first
        self.scan([], {0: [(ANNA_BOX, ANNA)], 1: [(BEN_BOX, BEN)]})

        (face,) = self.faces()
        self.assertEqual(frame_times(10.0)[1], face.video_time)
        self.assertIsNotNone(Photo.objects.get(pk=self.video.pk).faces_scanned_at)

    def test_the_time_budget_stops_reading_frames(self) -> None:
        with patch.object(video_faces, "TIME_BUDGET_SECONDS", -1.0):
            self.scan([], {0: [(ANNA_BOX, ANNA)]})

        self.assertEqual(0, self.grab_frame.call_count)
        self.assertEqual(0, self.faces().count())

    def test_a_short_video_is_scanned_on_its_first_frame_only(self) -> None:
        short = self._photo(video=True, video_length="1.5")
        service = self.scan([], {}, photo=short)

        self.assertEqual(1, len(service.sources))
        self.grab_frame.assert_not_called()

    def test_photos_are_scanned_as_before(self) -> None:
        photo = self._photo()
        service = self.scan([(ANNA_BOX, ANNA)], {}, photo=photo)

        self.assertEqual(1, len(service.sources))
        self.grab_frame.assert_not_called()
        self.assertIsNone(self.faces(photo).get().video_time)

    @override_config(FACE_DETECTION_IN_VIDEOS_ENABLED=False)
    def test_with_the_switch_off_a_video_is_read_on_its_first_frame(self) -> None:
        service = self.scan([], {3: [(BEN_BOX, BEN)]})

        self.assertEqual(1, len(service.sources))
        self.grab_frame.assert_not_called()

    @override_settings(FEATURE_FACE_DETECTION_IN_VIDEOS=False)
    def test_the_environment_turns_the_frames_off_too(self) -> None:
        self.scan([], {3: [(BEN_BOX, BEN)]})

        self.grab_frame.assert_not_called()


class FrameFacesLeftAloneTest(TestCase):
    """Their frame is gone: nothing makes their box, crop or encoding again."""

    def setUp(self) -> None:
        self.user = create_test_user()
        self.video = create_test_photo(owner=self.user, video=True)
        self.frame_face = create_test_face(
            photo=self.video,
            video_time=4.0,
            image="",
            encoding="",
            location_top=10,
            location_right=60,
            location_bottom=50,
            location_left=20,
        )

    def test_train_faces_does_not_encode_it(self) -> None:
        self.assertFalse(faces_missing_encoding(self.user).exists())
        with patch.object(photo_faces, "get_face_encodings") as encode:
            photo_faces.generate_face_encoding(self.frame_face)

        encode.assert_not_called()

    def test_its_crop_is_not_cut_from_the_big_thumbnail(self) -> None:
        path = self.video.thumbnail.thumbnail_big.path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        Image.new("RGB", (WIDTH, HEIGHT), "white").save(path)
        self.addCleanup(os.remove, path)
        first_frame_face = create_test_face(
            photo=self.video,
            image="",
            location_top=10,
            location_right=60,
            location_bottom=50,
            location_left=20,
        )

        self.assertEqual(1, restore_missing_crops(self.user))
        first_frame_face.refresh_from_db()
        self.frame_face.refresh_from_db()
        self.assertTrue(first_frame_face.image)
        self.assertFalse(self.frame_face.image)

    def test_it_is_no_face_region_of_the_file(self) -> None:
        self.assertEqual([], list(face_regions._region_faces(self.video)))
        with patch.object(
            face_regions, "_cleared_region_tags", return_value={}
        ) as cleared:
            self.assertEqual({}, face_regions.get_face_region_tags(self.video, True))

        cleared.assert_called_once()

    def test_deduplication_keeps_overlapping_faces_of_two_frames(self) -> None:
        create_test_face(
            photo=self.video,
            video_time=8.0,
            location_top=10,
            location_right=60,
            location_bottom=50,
            location_left=20,
        )

        self.assertEqual(0, deduplicate_faces_of_photos([self.video.pk]))

    def test_deduplication_still_finds_duplicates_of_one_frame(self) -> None:
        create_test_face(
            photo=self.video,
            video_time=4.0,
            location_top=10,
            location_right=60,
            location_bottom=50,
            location_left=20,
        )

        self.assertEqual(1, deduplicate_faces_of_photos([self.video.pk]))
