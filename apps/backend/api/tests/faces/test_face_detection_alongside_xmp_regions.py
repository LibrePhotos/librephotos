"""Face regions from XMP no longer switch off face detection (#2260).

A desktop photo manager stores regions only for the faces someone tagged
there. The face service still looks at the photo: a detection overlapping an
imported region is the same face, and gives that face its encoding; every
other detection becomes a face of its own.

The face sidecar is never called: ``api.runtime.sidecars.http.post`` is
patched to answer the way the real one does.
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
from api.models import Face, Photo
from api.runtime import sidecars
from api.tests.metadata.exiftool_harness import RealExifToolTestCase
from api.tests.utils import create_test_photo, create_test_user

THUMB_WIDTH, THUMB_HEIGHT = 200, 100
ALICE = (20, 80, 60, 40)


def _face_service(
    boxes: list[tuple[int, int, int, int]], encodings: list[list[float]]
) -> requests.Response:
    response = requests.Response()
    response.status_code = 200
    response._content = json.dumps(
        {"face_locations": boxes, "encodings": encodings}
    ).encode()
    response.headers["Content-Type"] = "application/json"
    return response


def _encoding(seed: float) -> list[float]:
    return [seed + index / 10 for index in range(8)]


def _hex(encoding: list[float]) -> str:
    return np.array(encoding).tobytes().hex()


@override_settings(FEATURE_FACE_DETECTION=True)
class FaceDetectionAlongsideXmpRegionsTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        path = self.photo.thumbnail.thumbnail_big.path
        os.makedirs(os.path.dirname(path), exist_ok=True)
        Image.new("RGB", (THUMB_WIDTH, THUMB_HEIGHT), "white").save(path)
        self.addCleanup(os.remove, path)

    def _extract(self, regions, boxes, encodings):
        with (
            patch.object(extractor, "extract_from_exif", return_value=regions),
            patch.object(
                sidecars.http, "post", return_value=_face_service(boxes, encodings)
            ) as face_service,
        ):
            extract_faces(Photo.objects.get(pk=self.photo.pk))
        return face_service

    def _faces(self):
        return list(Face.objects.filter(photo=self.photo).select_related("person"))

    def test_the_other_people_in_a_photo_with_one_tagged_face_are_detected(self):
        boxes = [(22, 82, 62, 42), (20, 140, 60, 100), (30, 190, 70, 150)]
        encodings = [_encoding(1), _encoding(2), _encoding(3)]

        face_service = self._extract([(*ALICE, "Alice")], boxes, encodings)

        face_service.assert_called_once()
        faces = self._faces()
        self.assertEqual(len(faces), 3)
        named = [face for face in faces if face.person is not None]
        self.assertEqual([face.person.name for face in named], ["Alice"])
        alice = named[0]
        # Where XMP put her, with the encoding of the detection of her face.
        self.assertEqual(
            (
                alice.location_top,
                alice.location_right,
                alice.location_bottom,
                alice.location_left,
            ),
            ALICE,
        )
        self.assertEqual(alice.encoding, _hex(encodings[0]))
        others = {face.encoding for face in faces if face.person is None}
        self.assertEqual(others, {_hex(encodings[1]), _hex(encodings[2])})

    def test_a_photo_without_regions_gets_the_detected_faces(self):
        self._extract(None, [(20, 140, 60, 100)], [_encoding(2)])

        faces = self._faces()
        self.assertEqual(len(faces), 1)
        self.assertIsNone(faces[0].person)
        self.assertEqual(faces[0].encoding, _hex(_encoding(2)))

    def test_regions_for_every_face_create_no_duplicates(self):
        bob = (20, 140, 60, 100)
        regions = [(*ALICE, "Alice"), (*bob, "Bob")]
        boxes = [(22, 82, 62, 42), (21, 141, 61, 101)]

        self._extract(regions, boxes, [_encoding(1), _encoding(2)])

        faces = self._faces()
        self.assertEqual(sorted(face.person.name for face in faces), ["Alice", "Bob"])
        self.assertEqual(
            {face.person.name: face.encoding for face in faces},
            {"Alice": _hex(_encoding(1)), "Bob": _hex(_encoding(2))},
        )

    def test_scanning_again_adds_nothing(self):
        boxes = [(22, 82, 62, 42), (20, 140, 60, 100)]
        encodings = [_encoding(1), _encoding(2)]
        self._extract([(*ALICE, "Alice")], boxes, encodings)

        self._extract([(*ALICE, "Alice")], boxes, encodings)

        self.assertEqual(len(self._faces()), 2)

    def test_a_face_that_already_has_an_encoding_keeps_it(self):
        self._extract([(*ALICE, "Alice")], [(22, 82, 62, 42)], [_encoding(1)])

        self._extract([(*ALICE, "Alice")], [(22, 82, 62, 42)], [_encoding(9)])

        (alice,) = self._faces()
        self.assertEqual(alice.encoding, _hex(_encoding(1)))

    def test_the_tagged_face_is_saved_when_the_face_service_fails(self):
        with (
            patch.object(
                extractor, "extract_from_exif", return_value=[(*ALICE, "Alice")]
            ),
            patch.object(
                sidecars.http,
                "post",
                side_effect=requests.ConnectionError("Connection refused"),
            ),
        ):
            try:
                extract_faces(Photo.objects.get(pk=self.photo.pk))
            except requests.ConnectionError:
                pass  # Scan Faces records it and tries the photo again (#2199).

        (alice,) = self._faces()
        self.assertEqual(alice.person.name, "Alice")


# Stored picture: a red square on white, in the top left quarter.
STORED_WIDTH, STORED_HEIGHT = 240, 160
SQUARE = (20, 60, 70, 110)  # left, top, right, bottom in the stored picture


def _red_box(path: str) -> tuple[int, int, int, int]:
    """(top, right, bottom, left) of the red square in a picture."""
    pixels = np.array(Image.open(path).convert("RGB")).astype(int)
    red = (pixels[:, :, 0] > 150) & (pixels[:, :, 1] < 100) & (pixels[:, :, 2] < 100)
    rows = np.where(red.any(axis=1))[0]
    columns = np.where(red.any(axis=0))[0]
    return (
        int(rows[0]),
        int(columns[-1]) + 1,
        int(rows[-1]) + 1,
        int(columns[0]),
    )


@override_settings(FEATURE_FACE_DETECTION=True)
class RotatedRegionMeetsDetectionTest(RealExifToolTestCase):
    """A region ExifTool wrote into a rotated JPEG lands on the detected face."""

    def test_a_region_in_a_rotated_photo_is_the_detected_face(self):
        path = os.path.join(self.directory, "rotated.jpg")
        picture = Image.new("RGB", (STORED_WIDTH, STORED_HEIGHT), "white")
        picture.paste((230, 20, 20), SQUARE)
        picture.save(path, quality=95)
        left, top, right, bottom = SQUARE
        centre_x = (left + right) / 2 / STORED_WIDTH
        centre_y = (top + bottom) / 2 / STORED_HEIGHT
        width = (right - left) / STORED_WIDTH
        height = (bottom - top) / STORED_HEIGHT
        self.tag(
            path,
            "-Orientation#=6",
            "-XMP-mwg-rs:RegionInfo="
            f"{{AppliedToDimensions={{W={STORED_WIDTH},H={STORED_HEIGHT},Unit=pixel}},"
            f"RegionList=[{{Area={{X={centre_x},Y={centre_y},W={width},H={height},"
            "Unit=normalized},Name=Alice,Type=Face}]}",
        )
        photo = self.photo_for(path, create_test_user(), thumbnails=True)
        thumbnail = photo.thumbnail.thumbnail_big.path
        detected = _red_box(thumbnail)
        # Rotated: the stored picture is wider than tall, the thumbnail taller.
        self.assertGreater(*Image.open(thumbnail).size[::-1])

        (region,) = extractor.extract_from_exif(path, thumbnail)
        self.assertGreaterEqual(
            calculate_iou(region[:4], detected), FACE_OVERLAP_IOU_THRESHOLD
        )

        with patch.object(
            sidecars.http,
            "post",
            return_value=_face_service([detected], [_encoding(1)]),
        ):
            extract_faces(photo)

        (alice,) = Face.objects.filter(photo=photo).select_related("person")
        self.assertEqual(alice.person.name, "Alice")
        self.assertEqual(alice.encoding, _hex(_encoding(1)))
