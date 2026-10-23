"""The face sidecar's port of insightface (service/face_recognition/face_analysis.py).

Stored face embeddings are compared with new ones, so the port has to compute
what insightface 0.7.3 computed. The expected matrices below are
insightface's own output (``insightface.utils.face_align.estimate_norm`` with
scikit-image 0.26) for the same landmarks; the full detection and recognition
path was compared on real pictures with every model pack when the package was
dropped, and matched bit for bit.
"""

import os
import subprocess
import sys
import tempfile
from inspect import signature
from types import SimpleNamespace

import numpy as np
from django.test import SimpleTestCase

from api.runtime.supervisor import _service_environment
from service.face_recognition import face_analysis
from service.face_recognition.face_analysis import (
    Detector,
    FaceAnalysis,
    Recognizer,
    _route,
    estimate_norm,
)
from service.onnx_session import inference_session

TILTED = np.array(
    [
        [308.6700134277344, 367.7950134277344],
        [399.1659851074219, 393.0299987792969],
        [337.50201416015625, 431.0539855957031],
        [284.7330017089844, 477.37799072265625],
        [359.0249938964844, 496.322998046875],
    ],
    dtype=np.float32,
)
# The arcface template with left and right swapped: Umeyama's reflection case.
MIRRORED = np.array(
    [
        [150.29800415039062, 117.25199890136719],
        [97.44200134277344, 117.54399871826172],
        [124.03800201416016, 147.60499572753906],
        [146.09500122070312, 178.30599975585938],
        [102.3239974975586, 178.54800415039062],
    ],
    dtype=np.float32,
)


class EstimateNormTest(SimpleTestCase):
    """The alignment matrix is insightface's, to the last bits."""

    def assertMatrix(self, landmarks, size, expected):
        np.testing.assert_allclose(
            estimate_norm(landmarks, size), np.array(expected), rtol=1e-12, atol=1e-12
        )

    def test_a_tilted_face(self):
        self.assertMatrix(
            TILTED,
            112,
            [
                [0.3549930415498936, 0.10467094399173549, -109.2319725219887],
                [-0.10467094399173549, 0.3549930415498936, -46.49254032595556],
            ],
        )

    def test_a_128_px_crop_is_shifted_by_8_px(self):
        self.assertMatrix(
            TILTED,
            128,
            [
                [0.3549930415498936, 0.10467094399173549, -101.2319725219887],
                [-0.10467094399173549, 0.3549930415498936, -46.49254032595556],
            ],
        )

    def test_mirrored_landmarks(self):
        self.assertMatrix(
            MIRRORED,
            112,
            [
                [0.15021007959067553, -5.631844711440443e-07, 37.39427544021777],
                [5.631844711440443e-07, 0.15021007959067553, 49.69199970120821],
            ],
        )

    def test_landmarks_on_one_point_give_nan(self):
        matrix = estimate_norm(np.full((5, 2), 10.0, dtype=np.float32))

        self.assertTrue(np.isnan(matrix).all())

    def test_the_template_maps_onto_itself(self):
        matrix = estimate_norm(face_analysis.ARCFACE_DST.copy())

        np.testing.assert_allclose(matrix, [[1, 0, 0], [0, 1, 0]], atol=1e-5)


def _io(name, shape):
    return SimpleNamespace(name=name, shape=shape)


def _session(inputs, outputs):
    return SimpleNamespace(
        get_inputs=lambda: [_io(f"in{i}", s) for i, s in enumerate(inputs)],
        get_outputs=lambda: [_io(f"out{i}", [1, 1]) for i in range(outputs)],
    )


DETECTOR = ([[1, 3, "?", "?"]], 9)
RECOGNIZER = ([["None", 3, 112, 112]], 1)
LANDMARK = ([["None", 3, 192, 192]], 1)
GENDERAGE = ([["None", 3, 96, 96]], 1)


class RouteTest(SimpleTestCase):
    """Each model of a pack is told apart by its inputs and outputs."""

    def test_routes(self):
        self.assertEqual(_route(_session(*DETECTOR)), "detection")
        self.assertEqual(_route(_session(*RECOGNIZER)), "recognition")
        self.assertEqual(_route(_session(*LANDMARK)), "landmark")
        self.assertEqual(_route(_session(*GENDERAGE)), "genderage")
        self.assertEqual(_route(_session([[1, 3, 128, 128], [1, 512]], 1)), "swapper")
        self.assertIsNone(_route(_session([[1, 3, 100, 100]], 1)))

    def test_a_detector_without_landmarks_is_refused(self):
        with self.assertRaises(ValueError):
            Detector(_session([[1, 3, "?", "?"]], 6))

    def test_det_size_applies_only_to_a_detector_of_any_size(self):
        self.assertEqual(Detector(_session(*DETECTOR)).input_size, (640, 640))
        self.assertEqual(
            Detector(_session([[1, 3, 480, 320]], 15)).input_size, (320, 480)
        )

    def test_the_recognizer_takes_its_crop_size_from_the_model(self):
        self.assertEqual(Recognizer(_session(*RECOGNIZER)).input_size, (112, 112))


class FaceAnalysisLoadTest(SimpleTestCase):
    """A pack directory becomes one detector and one recognizer."""

    def _pack(self, models):
        holder = tempfile.TemporaryDirectory()
        self.addCleanup(holder.cleanup)
        # A quantised copy next to the models is not an .onnx file: never opened.
        for name in [*models, "det_500m.onnx.int8"]:
            with open(os.path.join(holder.name, name), "wb"):
                pass
        return holder.name

    def test_buffalo_l_keeps_only_detection_and_recognition(self):
        kinds = {
            "1k3d68.onnx": LANDMARK,
            "2d106det.onnx": LANDMARK,
            "det_10g.onnx": DETECTOR,
            "genderage.onnx": GENDERAGE,
            "w600k_r50.onnx": RECOGNIZER,
        }
        directory = self._pack(kinds)
        opened = []

        def new_session(path):
            opened.append(os.path.basename(path))
            return _session(*kinds[os.path.basename(path)])

        analysis = FaceAnalysis(directory, new_session=new_session)

        self.assertEqual(opened, sorted(kinds))
        self.assertEqual(analysis.detector.output_names[0], "out0")
        self.assertIsInstance(analysis.recognizer, Recognizer)

    def test_the_first_model_of_a_kind_wins(self):
        kinds = {
            "a_det.onnx": DETECTOR,
            "b_det.onnx": DETECTOR,
            "c_rec.onnx": RECOGNIZER,
        }
        directory = self._pack(kinds)
        sessions = {name: _session(*kind) for name, kind in kinds.items()}

        analysis = FaceAnalysis(
            directory, new_session=lambda path: sessions[os.path.basename(path)]
        )

        self.assertIs(analysis.detector.session, sessions["a_det.onnx"])

    def test_a_pack_without_a_recognizer_is_an_error(self):
        directory = self._pack({"det_500m.onnx": DETECTOR})

        with self.assertRaises(FileNotFoundError):
            FaceAnalysis(directory, new_session=lambda path: _session(*DETECTOR))

    def test_a_missing_pack_is_an_error_not_a_download(self):
        with self.assertRaises(FileNotFoundError):
            FaceAnalysis(os.path.join(tempfile.gettempdir(), "no-such-face-pack"))

    def test_sessions_come_from_onnx_session(self):
        # Issue #2445: by provider name WebGPU would silently run on the CPU.
        self.assertIs(
            signature(FaceAnalysis).parameters["new_session"].default,
            inference_session,
        )


class NmsTest(SimpleTestCase):
    def test_overlapping_boxes_keep_the_best(self):
        dets = np.array(
            [
                [0, 0, 100, 100, 0.9],
                [5, 5, 105, 105, 0.8],
                [200, 200, 260, 260, 0.7],
            ],
            dtype=np.float32,
        )

        self.assertEqual([int(i) for i in Detector._nms(dets)], [0, 2])


class FaceAnalysisGetTest(SimpleTestCase):
    def test_every_detected_face_gets_its_embedding(self):
        analysis = FaceAnalysis.__new__(FaceAnalysis)
        boxes = np.array([[1, 2, 30, 40, 0.9], [50, 60, 90, 99, 0.6]], np.float32)
        landmarks = np.zeros((2, 5, 2), np.float32)
        analysis.detector = SimpleNamespace(detect=lambda image: (boxes, landmarks))
        analysis.recognizer = SimpleNamespace(
            embedding=lambda image, kps: np.ones(4, np.float32)
        )

        faces = analysis.get(np.zeros((100, 100, 3), np.uint8))

        self.assertEqual(
            [face.bbox.tolist() for face in faces], [[1, 2, 30, 40], [50, 60, 90, 99]]
        )
        self.assertAlmostEqual(float(faces[1].det_score), 0.6, places=6)
        self.assertEqual(faces[0].embedding.tolist(), [1.0] * 4)


class ImportGraphTest(SimpleTestCase):
    """The face sidecar loads none of what the insightface package dragged in.

    Importing insightface imported matplotlib, scipy, scikit-image and
    albumentations (with pydantic) through modules nobody used; the standalone
    build compiled all of them, and the images installed them.
    """

    def test_importing_the_sidecar_loads_no_plotting_or_scipy(self):
        code = (
            "import sys, service.face_recognition.main\n"
            "heavy = {'insightface', 'matplotlib', 'scipy', 'skimage',"
            " 'albumentations', 'pydantic', 'onnx'}\n"
            "print(sorted({m.split('.')[0] for m in sys.modules} & heavy))"
        )
        with tempfile.TemporaryDirectory() as elsewhere:
            result = subprocess.run(
                [sys.executable, "-c", code],
                cwd=elsewhere,
                env=_service_environment(),
                capture_output=True,
                text=True,
                check=False,
            )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.strip().splitlines()[-1], "[]")
