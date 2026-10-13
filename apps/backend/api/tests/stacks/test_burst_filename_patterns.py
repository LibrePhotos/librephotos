"""Bursts from file names (#2555).

Only a name that says "burst" makes a burst on its own: Google/Android
``_BURST``, Pixel ``NNNNNIMG_NNNNN_BURST<time>`` and Samsung
``YYYYMMDD_HHMMSS_NNN``. A plain counter (``IMG_0001``, ``photo (1)``) is
what every camera and every download names its files; picked on purpose as a
pattern, its frames must come from one camera, count upwards and follow each
other within the rule's interval.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timedelta
from datetime import timezone as dt_timezone
from typing import Any
from unittest.mock import patch

from django.test import TestCase

from api.metadata.tags import Tags
from api.models.photo import Photo
from api.models.photo_stack import PhotoStack
from api.models.user import User
from api.stacks.burst_rules import (
    DEFAULT_HARD_RULES,
    BurstDetectionRule,
    BurstRuleTypes,
    check_filename_pattern,
    get_default_burst_detection_rules,
)
from api.stacks.detection import detect_burst_sequences
from api.tests.utils import create_test_file, create_test_photo, create_test_user

NOON = datetime(2025, 1, 1, 12, 0, 0, tzinfo=dt_timezone.utc)
FILENAME_RULE = next(
    rule
    for rule in DEFAULT_HARD_RULES
    if rule["rule_type"] == BurstRuleTypes.FILENAME_PATTERN
)


def _photo(
    owner: User,
    path: str,
    seconds: float | None,
    camera: str | None = "Canon EOS R5",
) -> Photo:
    fields: dict[str, Any] = {"owner": owner}
    if seconds is not None:
        whole = int(seconds)
        fields["exif_timestamp"] = NOON + timedelta(seconds=whole)
        fields["exif_timestamp_subsec"] = f"{round((seconds - whole) * 1000):03d}"
    if camera is not None:
        fields["camera_model"] = camera
    photo = create_test_photo(**fields)
    photo.main_file = create_test_file(path, owner)
    photo.save()
    return Photo.objects.select_related("main_file", "metadata").get(pk=photo.pk)


def _stacks(owner: User) -> list[set[str]]:
    stacks = PhotoStack.objects.filter(
        owner=owner, stack_type=PhotoStack.StackType.BURST_SEQUENCE
    )
    return sorted(
        (
            {
                os.path.basename(path)
                for path in stack.photos.values_list("main_file__path", flat=True)
            }
            for stack in stacks
        ),
        key=sorted,
    )


class BurstFilenameTestCase(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.use_rules([FILENAME_RULE])

    def use_rules(self, rules: list[dict[str, Any]]) -> None:
        self.user.burst_detection_rules = json.dumps(rules)
        self.user.save()

    def detect(self) -> list[set[str]]:
        # No maker notes: only the file names can make a burst.
        def no_tags(path: str, tags: list[str], **kwargs: object) -> list[object]:
            return [None for _ in tags]

        with patch("api.metadata.reader.get_metadata", side_effect=no_tags):
            detect_burst_sequences(self.user)
        return _stacks(self.user)


class CameraCounterIsNoBurstTest(BurstFilenameTestCase):
    """The default rule does not take a camera's file counter for a burst."""

    def test_a_folder_of_camera_files_is_not_one_burst(self) -> None:
        _photo(self.user, "/photos/day/IMG_0001.jpg", 9 * 3600)
        _photo(self.user, "/photos/day/IMG_0002.jpg", 9 * 3600 + 40)
        _photo(self.user, "/photos/day/IMG_4711.jpg", 17 * 3600, "Pixel 8")
        _photo(self.user, "/photos/day/DSC_0815.jpg", 18 * 3600, "NIKON Z 6")
        _photo(self.user, "/photos/day/DSC_0816.jpg", 18 * 3600 + 60, "NIKON Z 6")

        self.assertEqual([], self.detect())

    def test_with_all_default_rules(self) -> None:
        self.use_rules(get_default_burst_detection_rules())
        _photo(self.user, "/photos/day/IMG_0001.jpg", 0)
        _photo(self.user, "/photos/day/IMG_4711.jpg", 3600)

        self.assertEqual([], self.detect())

    def test_counter_names_do_not_match_the_default_rule(self) -> None:
        for name in ("IMG_0001", "IMG_4711", "DSC_0815", "vacation (1)", "IMG_1234_5"):
            with self.subTest(name=name):
                photo = _photo(self.user, f"/photos/{name}.jpg", 0)
                self.assertEqual((False, None), check_filename_pattern(photo))

    def test_download_copies_are_not_a_burst(self) -> None:
        _photo(self.user, "/photos/dl/vacation (1).jpg", 0)
        _photo(self.user, "/photos/dl/vacation (2).jpg", 0.5)

        self.assertEqual([], self.detect())


class BurstNamesTest(BurstFilenameTestCase):
    """Names that say "burst" group on the burst they name."""

    def test_pixel_burst_with_cover(self) -> None:
        burst = "BURST20200302155220435"
        for frame in range(3):
            cover = "_COVER" if frame == 1 else ""
            _photo(
                self.user,
                f"/photos/pixel/{frame:05d}IMG_{frame:05d}_{burst}{cover}.jpg",
                frame * 0.1,
            )
        _photo(
            self.user, "/photos/pixel/00000IMG_00000_BURST20200302160000000.jpg", 600
        )

        self.assertEqual(
            [
                {
                    f"00000IMG_00000_{burst}.jpg",
                    f"00001IMG_00001_{burst}_COVER.jpg",
                    f"00002IMG_00002_{burst}.jpg",
                }
            ],
            self.detect(),
        )

    def test_google_burst_suffix(self) -> None:
        for frame in (1, 2, 3):
            _photo(self.user, f"/photos/g/IMG_20151009_143426_BURST{frame}.jpg", 0)
        _photo(self.user, "/photos/g/IMG_20151009_150000_BURST1.jpg", 1800)
        _photo(self.user, "/photos/g/IMG_20151009_150000_BURST2.jpg", 1800)

        self.assertEqual(
            [
                {
                    "IMG_20151009_143426_BURST1.jpg",
                    "IMG_20151009_143426_BURST2.jpg",
                    "IMG_20151009_143426_BURST3.jpg",
                },
                {
                    "IMG_20151009_150000_BURST1.jpg",
                    "IMG_20151009_150000_BURST2.jpg",
                },
            ],
            self.detect(),
        )

    def test_samsung_burst_with_cover(self) -> None:
        _photo(self.user, "/photos/s/20200115_123456_001_COVER.jpg", 0)
        _photo(self.user, "/photos/s/20200115_123456_002.jpg", 0.1)
        _photo(self.user, "/photos/s/20200115_123456_003.jpg", 0.2)
        # A second burst a minute later, and a single shot.
        _photo(self.user, "/photos/s/20200115_123556_001.jpg", 60)
        _photo(self.user, "/photos/s/20200115_123556_002.jpg", 60.1)
        _photo(self.user, "/photos/s/20200115_130000.jpg", 1800)

        self.assertEqual(
            [
                {
                    "20200115_123456_001_COVER.jpg",
                    "20200115_123456_002.jpg",
                    "20200115_123456_003.jpg",
                },
                {"20200115_123556_001.jpg", "20200115_123556_002.jpg"},
            ],
            self.detect(),
        )

    def test_burst_names_need_no_capture_time(self) -> None:
        _photo(self.user, "/photos/g/IMG_20151009_143426_BURST1.jpg", None, None)
        _photo(self.user, "/photos/g/IMG_20151009_143426_BURST2.jpg", None, None)

        self.assertEqual(
            [{"IMG_20151009_143426_BURST1.jpg", "IMG_20151009_143426_BURST2.jpg"}],
            self.detect(),
        )

    def test_same_name_in_two_folders_is_two_bursts(self) -> None:
        for folder in ("a", "b"):
            for frame in (1, 2):
                _photo(self.user, f"/photos/{folder}/IMG_1_BURST{frame}.jpg", 0)

        self.assertEqual(
            [{"IMG_1_BURST1.jpg", "IMG_1_BURST2.jpg"}] * 2,
            self.detect(),
        )


class CounterPatternTest(BurstFilenameTestCase):
    """A counter pattern picked on purpose: one camera, upwards, close in time."""

    def setUp(self) -> None:
        super().setUp()
        self.use_rules([{**FILENAME_RULE, "pattern_type": "sequence_suffix"}])

    def test_frames_close_in_time_from_one_camera(self) -> None:
        _photo(self.user, "/photos/c/IMG_0001.jpg", 0)
        _photo(self.user, "/photos/c/IMG_0002.jpg", 0.3)
        _photo(self.user, "/photos/c/IMG_0003.jpg", 0.6)
        # An hour later: a photo of its own.
        _photo(self.user, "/photos/c/IMG_0004.jpg", 3600)
        # Another camera with the same counter name, in the same moment.
        _photo(self.user, "/photos/c/IMG_0101.jpg", 0.4, "Pixel 8")

        self.assertEqual(
            [{"IMG_0001.jpg", "IMG_0002.jpg", "IMG_0003.jpg"}], self.detect()
        )

    def test_the_counter_must_count_upwards(self) -> None:
        # Two bodies of one model, no serial numbers read: the counters
        # interleave, so no frame follows its predecessor's number.
        _photo(self.user, "/photos/c/IMG_0500.jpg", 0)
        _photo(self.user, "/photos/c/IMG_0100.jpg", 0.3)
        _photo(self.user, "/photos/c/IMG_0501.jpg", 0.6)
        _photo(self.user, "/photos/c/IMG_0101.jpg", 0.9)

        self.assertEqual([], self.detect())

    def test_frames_without_capture_time_or_camera_are_no_burst(self) -> None:
        _photo(self.user, "/photos/c/IMG_0001.jpg", None)
        _photo(self.user, "/photos/c/IMG_0002.jpg", None)
        _photo(self.user, "/photos/c/SCAN_0001.jpg", 10, None)
        _photo(self.user, "/photos/c/SCAN_0002.jpg", 10.2, None)

        self.assertEqual([], self.detect())

    def test_bracketed_counter(self) -> None:
        self.use_rules([{**FILENAME_RULE, "pattern_type": "bracketed_sequence"}])
        _photo(self.user, "/photos/c/party (1).jpg", 0)
        _photo(self.user, "/photos/c/party (2).jpg", 0.5)
        _photo(self.user, "/photos/c/party (3).jpg", 7200)

        self.assertEqual([{"party (1).jpg", "party (2).jpg"}], self.detect())

    def test_custom_pattern_is_held_to_the_same_checks(self) -> None:
        self.use_rules([{**FILENAME_RULE, "custom_pattern": r"_\d{3,}$"}])
        _photo(self.user, "/photos/c/DSC_0815.jpg", 0)
        _photo(self.user, "/photos/c/DSC_0816.jpg", 0.2)
        _photo(self.user, "/photos/c/DSC_0900.jpg", 5000)

        self.assertEqual([{"DSC_0815.jpg", "DSC_0816.jpg"}], self.detect())

    def test_rule_interval_is_used(self) -> None:
        self.use_rules(
            [{**FILENAME_RULE, "pattern_type": "sequence_suffix", "interval_ms": 5000}]
        )
        _photo(self.user, "/photos/c/IMG_0001.jpg", 0)
        _photo(self.user, "/photos/c/IMG_0002.jpg", 4)

        self.assertEqual([{"IMG_0001.jpg", "IMG_0002.jpg"}], self.detect())


class CameraMakeTest(BurstFilenameTestCase):
    """The make that rescans now fill (#2265) does not split a burst."""

    def _set_make(self, photo: Photo, make: str) -> None:
        assert photo.metadata is not None
        photo.metadata.camera_make = make
        photo.metadata.save()

    def test_counter_burst_with_and_without_make(self) -> None:
        self.use_rules([{**FILENAME_RULE, "pattern_type": "sequence_suffix"}])
        _photo(self.user, "/photos/c/IMG_0001.jpg", 0)
        self._set_make(_photo(self.user, "/photos/c/IMG_0002.jpg", 0.2), "Canon")

        self.assertEqual([{"IMG_0001.jpg", "IMG_0002.jpg"}], self.detect())

    def test_exif_burst_with_and_without_make(self) -> None:
        rule = BurstDetectionRule(
            {"id": 1, "rule_type": BurstRuleTypes.EXIF_BURST_MODE}
        )
        old = _photo(self.user, "/photos/e/a.jpg", 0)
        rescanned = _photo(self.user, "/photos/e/b.jpg", 0.2)
        self._set_make(rescanned, "Canon")

        self.assertEqual(
            rule.is_burst_photo(old, {Tags.BURST_MODE: 1}),
            rule.is_burst_photo(rescanned, {Tags.BURST_MODE: 1}),
        )
