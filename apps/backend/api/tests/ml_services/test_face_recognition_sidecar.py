from types import SimpleNamespace

from django.test import SimpleTestCase

from service.face_recognition.main import (
    _find_best_face_match,
    _normalize_model_name,
)


class FaceRecognitionServiceTest(SimpleTestCase):
    def test_find_best_face_match_uses_requested_order(self):
        face_one = SimpleNamespace(bbox=(0, 10, 20, 30), embedding=[1.0, 2.0])
        face_two = SimpleNamespace(bbox=(40, 50, 70, 80), embedding=[3.0, 4.0])

        matches = _find_best_face_match(
            [(10, 20, 30, 0), (50, 70, 80, 40)],
            [face_two, face_one],
        )

        self.assertEqual(matches, [face_one, face_two])

    def test_normalize_model_name_falls_back_to_default(self):
        self.assertEqual(_normalize_model_name("not-a-model"), "buffalo_sc")
