"""Face regions whose picture was turned a quarter after they were written (#2887).

An exporter that bakes the rotation into the pixels (and resets Orientation)
can keep the MWG-RS regions of the picture as it was: ``AppliedToDimensions``
still describes the old raster, a quarter turn off the current one. The
region as written then lands 90 degrees away from the face. The dimensions
prove the quarter turn but not its direction, so a region is moved onto one
of the two quarter turns only when the face service confirms that one alone
and not the region as written; otherwise it stays as written.
"""

import json
import os
from unittest.mock import patch

import numpy as np
import requests
from django.test import TestCase, override_settings
from PIL import Image

from api.faces import extractor
from api.faces.geometry import FACE_OVERLAP_IOU_THRESHOLD, calculate_iou
from api.faces.photo_faces import extract_faces
from api.models import Face
from api.runtime import sidecars
from api.tests.metadata.exiftool_harness import RealExifToolTestCase
from api.tests.utils import create_test_user

IMAGE_PATH = "/photos/img.jpg"
THUMB_PATH = "/thumbs/img.jpg"

# A portrait big thumbnail, 100 px wide and 200 px high.
FAKE_THUMB = np.zeros((200, 100, 3), dtype=np.uint8)
AREA = {"X": "0.25", "Y": "0.75", "W": "0.2", "H": "0.4", "Unit": "normalized"}
# A landscape raster a quarter turn off the thumbnail, at another size.
STALE = {"W": "400", "H": "200", "Unit": "pixel"}

# (top, right, bottom, left) in the thumbnail of AREA as written, and of AREA
# once the pixels are turned a quarter clockwise or counter-clockwise.
AS_WRITTEN = (110, 35, 190, 15)
CLOCKWISE = (30, 45, 70, 5)
COUNTER_CLOCKWISE = (130, 95, 170, 55)


def _near(box):
    """A detection a couple of pixels off ``box``, as a detector reports it."""
    top, right, bottom, left = box
    return (top + 2, right + 2, bottom + 2, left + 2, None, np.zeros(4))


class StaleQuarterTurnTest(TestCase):
    """``extract_from_exif`` with the detected faces; ExifTool and the thumbnail mocked."""

    def setUp(self):
        meta_patcher = patch("api.faces.extractor.get_metadata")
        self.mock_get_metadata = meta_patcher.start()
        self.addCleanup(meta_patcher.stop)
        open_patcher = patch(
            "api.faces.extractor.PIL.Image.open", return_value=FAKE_THUMB
        )
        open_patcher.start()
        self.addCleanup(open_patcher.stop)

    def box(self, detected, dimensions=STALE, orientation=None):
        region_info = {
            "AppliedToDimensions": dimensions,
            "RegionList": [{"Type": "Face", "Name": "Alice", "Area": dict(AREA)}],
        }
        self.mock_get_metadata.return_value = (region_info, orientation, None, None)
        ((*box, name),) = extractor.extract_from_exif(
            IMAGE_PATH, THUMB_PATH, detected_faces=detected
        )
        self.assertEqual(name, "Alice")
        return tuple(box)

    def test_the_turn_the_face_service_confirms_is_taken(self):
        self.assertEqual(self.box([_near(CLOCKWISE)]), CLOCKWISE)
        self.assertEqual(self.box([_near(COUNTER_CLOCKWISE)]), COUNTER_CLOCKWISE)

    def test_a_region_on_a_detected_face_stays_as_written(self):
        detected = [_near(AS_WRITTEN), _near(CLOCKWISE)]
        self.assertEqual(self.box(detected), AS_WRITTEN)

    def test_both_turns_confirmed_is_no_answer(self):
        detected = [_near(CLOCKWISE), _near(COUNTER_CLOCKWISE)]
        self.assertEqual(self.box(detected), AS_WRITTEN)

    def test_neither_turn_confirmed_is_no_answer(self):
        self.assertEqual(self.box([_near((0, 100, 20, 80))]), AS_WRITTEN)
        self.assertEqual(self.box([]), AS_WRITTEN)

    def test_without_detections_the_region_stays_as_written(self):
        self.assertEqual(self.box(None), AS_WRITTEN)

    def test_dimensions_that_fit_the_picture_are_not_stale(self):
        for dimensions in (
            {"W": "1000", "H": "2000", "Unit": "pixel"},
            # Wider than tall, but not this picture turned.
            {"W": "300", "H": "200", "Unit": "pixel"},
            {"W": "400", "H": "200", "Unit": "inch"},
            {"W": "400", "Unit": "pixel"},
            {"W": "0", "H": "200", "Unit": "pixel"},
            None,
        ):
            with self.subTest(dimensions=dimensions):
                self.assertEqual(
                    self.box([_near(CLOCKWISE)], dimensions=dimensions), AS_WRITTEN
                )

    def test_dimensions_are_those_of_the_stored_picture(self):
        """A file shown turned (Orientation 6) stores its pixels landscape:
        landscape dimensions are right for it, not a quarter turn off."""
        shown = self.box([], orientation="Rotate 90 CW")
        # Where a quarter turn of the shown picture would put the region.
        turned = (10, 85, 90, 65)
        self.assertEqual(self.box([_near(turned)], orientation="Rotate 90 CW"), shown)

    def test_the_turn_is_of_the_stored_picture_under_its_orientation(self):
        portrait = {"W": "200", "H": "400", "Unit": "pixel"}
        # The stored pixels turned clockwise, then shown under Orientation 6.
        turned = (10, 85, 90, 65)
        self.assertEqual(
            self.box([_near(turned)], dimensions=portrait, orientation=6), turned
        )


def _face_service(boxes, encodings):
    response = requests.Response()
    response.status_code = 200
    response._content = json.dumps(
        {"face_locations": boxes, "encodings": encodings}
    ).encode()
    response.headers["Content-Type"] = "application/json"
    return response


def _red_box(path):
    """(top, right, bottom, left) of the red square in a picture."""
    pixels = np.array(Image.open(path).convert("RGB")).astype(int)
    red = (pixels[:, :, 0] > 150) & (pixels[:, :, 1] < 100) & (pixels[:, :, 2] < 100)
    rows = np.where(red.any(axis=1))[0]
    columns = np.where(red.any(axis=0))[0]
    return (int(rows[0]), int(columns[-1]) + 1, int(rows[-1]) + 1, int(columns[0]))


ENCODING = [0.1 * index for index in range(8)]


@override_settings(FEATURE_FACE_DETECTION=True)
class TurnedJpegTestCase(RealExifToolTestCase):
    """A JPEG whose pixels were turned after its region was written, read by ExifTool.

    ``self.written`` is the box of the region as written, ``self.face`` the
    face in the big thumbnail.
    """

    def setUp(self):
        super().setUp()
        # The region is written for a landscape picture, a red square its face.
        landscape = Image.new("RGB", (240, 160), "white")
        square = (20, 60, 70, 110)  # left, top, right, bottom
        landscape.paste((230, 20, 20), square)
        left, top, right, bottom = square
        area = (
            f"X={(left + right) / 2 / 240},Y={(top + bottom) / 2 / 160},"
            f"W={(right - left) / 240},H={(bottom - top) / 160},Unit=normalized"
        )
        # Then the pixels are turned clockwise into a portrait JPEG with no
        # Orientation; the region and its (resized) dimensions stay.
        self.path = os.path.join(self.directory, "turned.jpg")
        landscape.transpose(Image.Transpose.ROTATE_270).save(self.path, quality=95)
        self.tag(
            self.path,
            "-XMP-mwg-rs:RegionInfo="
            "{AppliedToDimensions={W=480,H=320,Unit=pixel},"
            f"RegionList=[{{Area={{{area}}},Name=Alice,Type=Face}}]}}",
        )
        self.photo = self.photo_for(self.path, create_test_user(), thumbnails=True)
        self.thumbnail = self.photo.thumbnail.thumbnail_big.path
        self.face = _red_box(self.thumbnail)
        ((*written, _),) = extractor.extract_from_exif(self.path, self.thumbnail)
        self.written = tuple(written)
        # The bug: the region as written is not on the face.
        self.assertLess(
            calculate_iou(self.written, self.face), FACE_OVERLAP_IOU_THRESHOLD
        )

    def _extract(self, boxes):
        with patch.object(
            sidecars.http,
            "post",
            return_value=_face_service(boxes, [ENCODING] * len(boxes)),
        ):
            extract_faces(self.photo)
        return list(Face.objects.filter(photo=self.photo).select_related("person"))

    @staticmethod
    def _box(face):
        return (
            face.location_top,
            face.location_right,
            face.location_bottom,
            face.location_left,
        )


class PhysicallyTurnedJpegTest(TurnedJpegTestCase):
    def test_the_region_is_moved_onto_the_detected_face(self):
        (alice,) = self._extract([self.face])

        self.assertEqual(alice.person.name, "Alice")
        self.assertEqual(alice.encoding, np.array(ENCODING).tobytes().hex())
        self.assertGreaterEqual(
            calculate_iou(self._box(alice), self.face), FACE_OVERLAP_IOU_THRESHOLD
        )

    def test_without_a_confirming_detection_the_region_stays_as_written(self):
        # The top right corner: on neither quarter turn.
        width, height = Image.open(self.thumbnail).size
        elsewhere = (
            int(height * 0.02),
            int(width * 0.97),
            int(height * 0.12),
            int(width * 0.8),
        )

        faces = self._extract([elsewhere])

        (alice,) = [face for face in faces if face.person is not None]
        self.assertEqual(self._box(alice), self.written)
        self.assertEqual(len(faces), 2)

    def test_the_region_is_saved_as_written_when_the_face_service_is_down(self):
        with patch.object(
            sidecars.http,
            "post",
            side_effect=requests.ConnectionError("Connection refused"),
        ):
            with self.assertRaises(requests.ConnectionError):
                extract_faces(self.photo)

        (alice,) = Face.objects.filter(photo=self.photo).select_related("person")
        self.assertEqual(alice.person.name, "Alice")
        self.assertEqual(self._box(alice), self.written)
