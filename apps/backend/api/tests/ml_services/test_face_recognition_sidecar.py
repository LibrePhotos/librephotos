from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from django.test import SimpleTestCase

from service.face_recognition import main as face_main
from service.face_recognition.main import (
    MIN_FACE_MATCH_IOU,
    _find_best_face_match,
    _normalize_model_name,
)


def _detected(bbox, embedding):
    """A face as insightface returns it: bbox is (left, top, right, bottom)."""
    return SimpleNamespace(bbox=bbox, embedding=np.array(embedding))


class FaceRecognitionServiceTest(SimpleTestCase):
    def test_find_best_face_match_uses_requested_order(self):
        face_one = _detected((0, 10, 20, 30), [1.0, 2.0])
        face_two = _detected((40, 50, 70, 80), [3.0, 4.0])

        matches = _find_best_face_match(
            [(10, 20, 30, 0), (50, 70, 80, 40)],
            [face_two, face_one],
        )

        self.assertEqual(matches, [face_one, face_two])

    def test_normalize_model_name_falls_back_to_default(self):
        self.assertEqual(_normalize_model_name("not-a-model"), "buffalo_sc")


class UnmatchedRegionTest(SimpleTestCase):
    """A region no detected face overlaps gets no embedding, not a stranger's.

    Manually drawn and XMP-imported regions are encoded by asking the sidecar
    to detect every face and pick the one at the region. When the detector
    finds nothing there (a profile, a face it cannot see at this size) any
    other face in the picture used to win with an IoU of 0, and its embedding
    was stored for the region - clustering then put the person with someone
    else.
    """

    def test_a_region_nothing_overlaps_is_left_unmatched(self):
        elsewhere = _detected((100, 100, 140, 140), [9.0, 9.0])

        matches = _find_best_face_match([(0, 30, 30, 0)], [elsewhere])

        self.assertEqual(matches, [None])

    def test_a_barely_overlapping_face_is_not_a_match(self):
        # A 100x100 region and a 100x100 face sharing a 20x100 strip: IoU 1/9.
        neighbour = _detected((80, 0, 180, 100), [9.0, 9.0])

        matches = _find_best_face_match([(0, 100, 100, 0)], [neighbour])

        self.assertEqual(matches, [None])

    def test_a_loosely_drawn_box_still_matches(self):
        # The detector's box sits inside a generously drawn region.
        face = _detected((10, 10, 90, 90), [1.0, 2.0])

        matches = _find_best_face_match([(0, 100, 100, 0)], [face])

        self.assertEqual(matches, [face])

    def test_the_threshold_is_a_real_overlap(self):
        self.assertGreater(MIN_FACE_MATCH_IOU, 0.0)
        self.assertLess(MIN_FACE_MATCH_IOU, 1.0)

    def test_slots_stay_aligned_with_the_requested_regions(self):
        face = _detected((40, 50, 70, 80), [3.0, 4.0])

        matches = _find_best_face_match(
            [(0, 10, 10, 0), (50, 70, 80, 40)],
            [face],
        )

        self.assertEqual(matches, [None, face])

    def test_the_endpoint_answers_null_for_an_unmatched_region(self):
        face = _detected((40, 50, 70, 80), [3.0, 4.0])
        analysis = SimpleNamespace(get=lambda image: [face])
        face_main.app.config["TESTING"] = True
        with (
            patch.object(face_main, "_get_face_analysis", return_value=analysis),
            patch.object(face_main.Image, "open") as open_image,
        ):
            open_image.return_value.convert.return_value = np.zeros((4, 4, 3))
            response = face_main.app.test_client().post(
                "/face-encodings",
                json={
                    "source": "/tmp/p.jpg",
                    "face_locations": [[0, 10, 10, 0], [50, 70, 80, 40]],
                },
            )

        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.get_json()["encodings"], [None, [3.0, 4.0]])


class FaceAnalysisProvidersTest(SimpleTestCase):
    """insightface runs on the providers service.onnx_session picks."""

    def setUp(self):
        cache = patch.dict(face_main.face_analysis_models, clear=True)
        cache.start()
        self.addCleanup(cache.stop)

    def _load(self, providers):
        with (
            patch.object(face_main, "execution_providers", return_value=providers),
            patch("insightface.app.FaceAnalysis") as analysis,
        ):
            face_main._get_face_analysis("buffalo_sc")
        return analysis

    def test_cuda_is_used_when_available(self):
        providers = ["CUDAExecutionProvider", "CPUExecutionProvider"]

        analysis = self._load(providers)

        self.assertEqual(analysis.call_args.kwargs["providers"], providers)
        # A negative ctx_id would switch every model back to the CPU.
        analysis.return_value.prepare.assert_called_once_with(
            ctx_id=0, det_size=(640, 640)
        )

    def test_a_cpu_build_stays_on_the_cpu(self):
        analysis = self._load(["CPUExecutionProvider"])

        analysis.return_value.prepare.assert_called_once_with(
            ctx_id=-1, det_size=(640, 640)
        )
