"""Burst detection on what cameras write (#2256).

The exif service reads with ``-n``, so maker-note modes arrive as numbers:
Canon's ``ContinuousDrive`` is ``1``, not ``"Continuous"``. A burst is grouped
per camera on the capture time to the sub-second (``SubSecTimeOriginal``),
not per whole second, and a photo whose rule check fails is skipped, not the
whole job.
"""

from __future__ import annotations

import json
import os
import struct
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import PIL.Image
from django.test import TestCase

from api.metadata.photo_reader import extract_exif_data
from api.metadata.tags import Tags
from api.models.photo import Photo
from api.models.photo_stack import PhotoStack
from api.models.user import User
from api.stacks.burst_rules import (
    BurstDetectionRule,
    BurstRuleTypes,
    get_default_burst_detection_rules,
    group_photos_by_timestamp,
)
from api.stacks.detection import detect_burst_sequences
from api.tests.metadata.exiftool_harness import RealExifToolTestCase
from api.tests.utils import create_test_file, create_test_photo, create_test_user

NOON = datetime(2025, 1, 1, 12, 0, 0, tzinfo=UTC)
BURST_MODE_RULE = {
    "id": 1,
    "rule_type": BurstRuleTypes.EXIF_BURST_MODE,
    "category": "hard",
    "enabled": True,
}
SEQUENCE_RULE = {
    "id": 2,
    "rule_type": BurstRuleTypes.EXIF_SEQUENCE_NUMBER,
    "category": "hard",
    "enabled": True,
}


def _photo(
    owner: User,
    name: str,
    second: int,
    subsec: str | None,
    camera: str = "Canon EOS R5",
) -> Photo:
    photo = create_test_photo(
        owner=owner,
        exif_timestamp=NOON + timedelta(seconds=second),
        exif_timestamp_subsec=subsec,
        camera_model=camera,
    )
    photo.main_file = create_test_file(f"/photos/{name}.jpg", owner)
    photo.save()
    return Photo.objects.select_related("main_file", "metadata").get(pk=photo.pk)


def _with_serial(photo: Photo, serial: str | None) -> Photo:
    """``photo`` with the serial number a scan since #2265 reads."""
    assert photo.metadata is not None
    photo.metadata.serial_number = serial
    photo.metadata.save()
    return photo


def _burst_stacks(owner: User) -> list[PhotoStack]:
    return list(
        PhotoStack.objects.filter(
            owner=owner, stack_type=PhotoStack.StackType.BURST_SEQUENCE
        )
    )


def _names(stack: PhotoStack) -> set[str]:
    return {
        os.path.basename(path)
        for path in stack.photos.values_list("main_file__path", flat=True)
    }


class BurstModeTagValuesTest(TestCase):
    """The rule reads maker-note modes as the exif service returns them."""

    def setUp(self) -> None:
        self.user = create_test_user()
        self.photo = _photo(self.user, "IMG_0001", 0, None)
        self.rule = BurstDetectionRule(BURST_MODE_RULE)

    def test_canon_continuous_drive_codes(self) -> None:
        # exiftool -listx: 0 Single, 2 Movie, 6 Silent Single, 9 Single, Silent;
        # 1, 3, 4, 5, 8 and 10 are continuous modes.
        for code, burst in [
            (0, False),
            (1, True),
            (2, False),
            (3, True),
            (4, True),
            (5, True),
            (6, False),
            (8, True),
            (9, False),
            (10, True),
        ]:
            with self.subTest(code=code):
                is_burst, _ = self.rule.is_burst_photo(
                    self.photo, {Tags.CONTINUOUS_DRIVE: code}
                )
                self.assertEqual(burst, is_burst)

    def test_printed_continuous_drive_values(self) -> None:
        for value, burst in [
            ("Continuous", True),
            ("Continuous, High", True),
            ("Single", False),
            ("Single, Silent", False),
            ("Movie", False),
        ]:
            with self.subTest(value=value):
                is_burst, _ = self.rule.is_burst_photo(
                    self.photo, {Tags.CONTINUOUS_DRIVE: value}
                )
                self.assertEqual(burst, is_burst)

    def test_burst_mode_codes_and_words(self) -> None:
        for value, burst in [(0, False), (1, True), ("Off", False), ("On", True)]:
            with self.subTest(value=value):
                is_burst, _ = self.rule.is_burst_photo(
                    self.photo, {Tags.BURST_MODE: value}
                )
                self.assertEqual(burst, is_burst)

    def test_single_shot_sequence_number_is_no_burst(self) -> None:
        # Sony and FujiFilm: 0 = Single, 255 / 65535 = n/a.
        rule = BurstDetectionRule(SEQUENCE_RULE)
        for value, burst in [(0, False), (255, False), (65535, False), (3, True)]:
            with self.subTest(value=value):
                is_burst, _ = rule.is_burst_photo(
                    self.photo, {Tags.SEQUENCE_NUMBER: value}
                )
                self.assertEqual(burst, is_burst)


class BurstGroupingTest(TestCase):
    """Hard-rule bursts are grouped per camera on the sub-second capture time."""

    def setUp(self) -> None:
        self.user = create_test_user()
        self.user.burst_detection_rules = json.dumps([BURST_MODE_RULE])
        self.user.save()

    def _detect(self, tags_by_name: dict[str, dict[str, object]]) -> int:
        def fake_get_metadata(
            path: str, tags: list[str], **kwargs: object
        ) -> list[object]:
            found = tags_by_name.get(os.path.splitext(os.path.basename(path))[0], {})
            return [found.get(tag) for tag in tags]

        with patch("api.metadata.reader.get_metadata", side_effect=fake_get_metadata):
            return detect_burst_sequences(self.user)

    def test_burst_across_a_second_boundary_is_one_stack_in_frame_order(self) -> None:
        # 5 fps from 12:00:00.600 to 12:00:01.200, created out of order.
        _photo(self.user, "f3", 1, "000")
        _photo(self.user, "f1", 0, "600")
        _photo(self.user, "f4", 1, "200")
        _photo(self.user, "f2", 0, "800")
        burst = {Tags.BURST_MODE: 1}

        found = self._detect({name: burst for name in ("f1", "f2", "f3", "f4")})

        stacks = _burst_stacks(self.user)
        self.assertEqual(1, found)
        self.assertEqual(
            [{"f1.jpg", "f2.jpg", "f3.jpg", "f4.jpg"}],
            [_names(stack) for stack in stacks],
        )
        # The cover is the middle frame of the sequence: f3, not whichever
        # photo of 12:00:01 the database returns first.
        cover = stacks[0].primary_photo
        assert cover is not None and cover.main_file is not None
        self.assertEqual("f3.jpg", os.path.basename(cover.main_file.path))

    def test_two_cameras_in_the_same_second_are_two_stacks(self) -> None:
        for name, subsec, camera in [
            ("a1", "100", "Canon EOS R5"),
            ("b1", "200", "NIKON Z 6"),
            ("a2", "300", "Canon EOS R5"),
            ("b2", "400", "NIKON Z 6"),
            ("a3", "500", "Canon EOS R5"),
        ]:
            _photo(self.user, name, 0, subsec, camera)
        burst = {Tags.BURST_MODE: 1}

        found = self._detect({name: burst for name in ("a1", "a2", "a3", "b1", "b2")})

        self.assertEqual(2, found)
        self.assertCountEqual(
            [{"a1.jpg", "a2.jpg", "a3.jpg"}, {"b1.jpg", "b2.jpg"}],
            [_names(stack) for stack in _burst_stacks(self.user)],
        )

    def test_a_frame_rescanned_since_serial_numbers_are_read_stays_in_its_burst(
        self,
    ) -> None:
        # #2566: only f2 was rescanned since #2265 started reading the serial
        # number; f1 and f3 do not have one yet.
        _photo(self.user, "f1", 0, "100")
        _with_serial(_photo(self.user, "f2", 0, "300"), "123")
        _photo(self.user, "f3", 0, "500")
        burst = {Tags.BURST_MODE: 1}

        found = self._detect({name: burst for name in ("f1", "f2", "f3")})

        self.assertEqual(1, found)
        self.assertEqual(
            [{"f1.jpg", "f2.jpg", "f3.jpg"}],
            [_names(stack) for stack in _burst_stacks(self.user)],
        )

    def test_two_bodies_of_one_model_are_two_stacks(self) -> None:
        for name, subsec, serial in [
            ("a1", "100", "111"),
            ("b1", "200", "222"),
            ("a2", "300", "111"),
            ("b2", "400", "222"),
            # Not rescanned yet: it could be either body.
            ("a3", "500", None),
        ]:
            _with_serial(_photo(self.user, name, 0, subsec), serial)
        burst = {Tags.BURST_MODE: 1}

        found = self._detect({name: burst for name in ("a1", "a2", "a3", "b1", "b2")})

        self.assertEqual(2, found)
        self.assertCountEqual(
            [{"a1.jpg", "a2.jpg"}, {"b1.jpg", "b2.jpg"}],
            [_names(stack) for stack in _burst_stacks(self.user)],
        )

    def test_a_pause_longer_than_the_interval_starts_a_new_burst(self) -> None:
        _photo(self.user, "a1", 0, "000")
        _photo(self.user, "a2", 0, "500")
        _photo(self.user, "b1", 5, "000")
        _photo(self.user, "b2", 5, "500")
        burst = {Tags.BURST_MODE: 1}

        found = self._detect({name: burst for name in ("a1", "a2", "b1", "b2")})

        self.assertEqual(2, found)
        self.assertCountEqual(
            [{"a1.jpg", "a2.jpg"}, {"b1.jpg", "b2.jpg"}],
            [_names(stack) for stack in _burst_stacks(self.user)],
        )

    def test_a_restarted_sequence_number_starts_a_new_burst(self) -> None:
        self.user.burst_detection_rules = json.dumps([SEQUENCE_RULE])
        self.user.save()
        for name, subsec in [
            ("a1", "000"),
            ("a2", "300"),
            ("b1", "600"),
            ("b2", "900"),
        ]:
            _photo(self.user, name, 0, subsec)

        found = self._detect(
            {
                "a1": {Tags.SEQUENCE_NUMBER: 1},
                "a2": {Tags.SEQUENCE_NUMBER: 2},
                "b1": {Tags.SEQUENCE_NUMBER: 1},
                "b2": {Tags.SEQUENCE_NUMBER: 2},
            }
        )

        self.assertEqual(2, found)
        self.assertCountEqual(
            [{"a1.jpg", "a2.jpg"}, {"b1.jpg", "b2.jpg"}],
            [_names(stack) for stack in _burst_stacks(self.user)],
        )

    def test_a_failing_rule_check_skips_the_photo_not_the_job(self) -> None:
        for name, subsec in [("bad", "000"), ("f1", "200"), ("f2", "400")]:
            _photo(self.user, name, 0, subsec)
        real_check = BurstDetectionRule.is_burst_photo

        def flaky_check(
            rule: BurstDetectionRule, photo: Photo, exif_tags: dict[str, object]
        ) -> tuple[bool, str | None]:
            assert photo.main_file is not None
            if photo.main_file.path.endswith("bad.jpg"):
                raise ValueError("odd maker note")
            return real_check(rule, photo, exif_tags)

        burst = {Tags.BURST_MODE: 1}
        with patch.object(BurstDetectionRule, "is_burst_photo", flaky_check):
            found = self._detect({name: burst for name in ("bad", "f1", "f2")})

        self.assertEqual(1, found)
        self.assertEqual(
            [{"f1.jpg", "f2.jpg"}], [_names(s) for s in _burst_stacks(self.user)]
        )


class TimestampProximitySubSecondTest(TestCase):
    """The soft rule compares capture times to the sub-second."""

    def setUp(self) -> None:
        self.user = create_test_user()

    def test_interval_is_measured_between_sub_second_times(self) -> None:
        # 200 ms apart across a second boundary: one burst.
        close = [_photo(self.user, "c1", 0, "900"), _photo(self.user, "c2", 1, "100")]
        # 900 ms apart within one second: two singles at 500 ms.
        apart = [_photo(self.user, "s1", 3, "000"), _photo(self.user, "s2", 3, "900")]

        self.assertEqual(
            [close], group_photos_by_timestamp(close + apart, interval_ms=500)
        )

    def test_same_camera_ignores_the_unread_make(self) -> None:
        first = _photo(self.user, "a1", 0, "100")
        second = _photo(self.user, "a2", 0, "300")
        # One photo was rescanned since the make was imported (#2265).
        assert second.metadata is not None
        second.metadata.camera_make = "Canon"
        second.metadata.save()

        self.assertEqual(
            [[first, second]],
            group_photos_by_timestamp([first, second], interval_ms=500),
        )

    def test_same_camera_ignores_an_unread_serial_number(self) -> None:
        # #2566: one photo was rescanned since the serial number is read.
        first = _photo(self.user, "a1", 0, "100")
        second = _with_serial(_photo(self.user, "a2", 0, "300"), "123")
        other_body = _with_serial(_photo(self.user, "b1", 0, "200"), "456")

        self.assertEqual(
            [[first, second]],
            group_photos_by_timestamp([first, second], interval_ms=500),
        )
        # Two serial numbers are two bodies: neither burst takes the frame
        # whose body is unknown.
        self.assertEqual(
            [],
            group_photos_by_timestamp([first, second, other_body], interval_ms=150),
        )


# ---- a Canon JPEG as a camera writes it ---------------------------------


def _ifd(entries: list[tuple[int, int, int, bytes]], base: int) -> bytes:
    """A little-endian TIFF IFD placed at ``base``, with its out-of-line values."""
    head = struct.pack("<H", len(entries))
    data = b""
    data_start = base + 2 + 12 * len(entries) + 4
    for tag, kind, count, payload in sorted(entries):
        if len(payload) <= 4:
            head += struct.pack("<HHI", tag, kind, count) + payload.ljust(4, b"\0")
        else:
            data += b"\0" * ((data_start + len(data)) % 2)
            head += struct.pack("<HHII", tag, kind, count, data_start + len(data))
            data += payload
    return head + struct.pack("<I", 0) + data


def canon_exif(continuous_drive: int, sequence_number: int, model: str) -> bytes:
    """An APP1 Exif block with a Canon maker note.

    ExifTool edits maker notes but does not create them, so the fixture builds
    the two Canon directories the rules read: CameraSettings (index 5 is
    ContinuousDrive) and ShotInfo (index 9 is SequenceNumber).
    """
    ascii_ = 2
    short = 3
    long_ = 4
    undefined = 7
    camera_settings = [98] + [0] * 48
    camera_settings[5] = continuous_drive
    shot_info = [68] + [0] * 33
    shot_info[9] = sequence_number
    make = b"Canon\0"
    model_bytes = model.encode() + b"\0"

    def ifd0(exif_offset: int) -> bytes:
        return _ifd(
            [
                (0x010F, ascii_, len(make), make),
                (0x0110, ascii_, len(model_bytes), model_bytes),
                (0x8769, long_, 1, struct.pack("<I", exif_offset)),
            ],
            8,
        )

    exif_offset = 8 + len(ifd0(0))
    maker_note_offset = exif_offset + 2 + 12 + 4
    maker_note = _ifd(
        [
            (0x0001, short, 49, struct.pack("<49h", *camera_settings)),
            (0x0004, short, 34, struct.pack("<34h", *shot_info)),
        ],
        maker_note_offset,
    )
    exif_ifd = (
        struct.pack("<H", 1)
        + struct.pack("<HHII", 0x927C, undefined, len(maker_note), maker_note_offset)
        + struct.pack("<I", 0)
    )
    tiff = b"II*\0" + struct.pack("<I", 8) + ifd0(exif_offset) + exif_ifd + maker_note
    return b"Exif\0\0" + tiff


@dataclass(frozen=True)
class Shot:
    """One frame as the camera wrote it, taken at 12:00:<second>.<subsec>."""

    name: str
    continuous_drive: int
    sequence_number: int
    second: int
    subsec: str


class CanonBurstWithRealExifToolTest(RealExifToolTestCase):
    """Detect stacks on Canon JPEGs read through the exif service."""

    def _canon(self, shot: Shot, width: int) -> str:
        path = os.path.join(self.directory, shot.name + ".jpg")
        exif = canon_exif(shot.continuous_drive, shot.sequence_number, "Canon EOS R5")
        PIL.Image.new("RGB", (width, 12)).save(path, exif=exif)
        self.tag(
            path,
            f"-DateTimeOriginal=2025:01:01 12:00:0{shot.second}",
            f"-SubSecTimeOriginal={shot.subsec}",
        )
        return path

    def test_continuous_shots_are_one_burst(self) -> None:
        user = create_test_user()
        user.burst_detection_rules = json.dumps(get_default_burst_detection_rules())
        user.save()
        shots = [
            Shot("canon_a", 1, 1, 0, "600"),
            Shot("canon_b", 1, 2, 0, "850"),
            Shot("canon_c", 1, 3, 1, "100"),
            # A single shot right after the burst.
            Shot("canon_d", 0, 0, 1, "250"),
        ]
        for index, shot in enumerate(shots):
            photo = self.photo_for(
                self._canon(shot, 16 + index),
                user,
                exif_timestamp=NOON + timedelta(seconds=shot.second),
            )
            extract_exif_data(photo)

        read_back = Photo.objects.get(main_file__path__endswith="canon_d.jpg")
        self.assertEqual("250", read_back.exif_timestamp_subsec)
        self.assertEqual(
            {Tags.CONTINUOUS_DRIVE: 1, Tags.SEQUENCE_NUMBER: 3},
            self.read_tags(
                os.path.join(self.directory, "canon_c.jpg"),
                Tags.CONTINUOUS_DRIVE,
                Tags.SEQUENCE_NUMBER,
            ),
        )

        found = detect_burst_sequences(user)

        self.assertEqual(1, found)
        self.assertEqual(
            [{"canon_a.jpg", "canon_b.jpg", "canon_c.jpg"}],
            [_names(stack) for stack in _burst_stacks(user)],
        )
