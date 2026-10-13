"""
Burst detection rules module for grouping photos taken in rapid succession.

This module provides a rules-based system for detecting burst sequences,
following the same pattern as api/metadata/datetime_rules.py. Rules are stored
as JSON in each user's profile and applied sequentially.

Rules are divided into two categories:
- Hard criteria: Deterministic detection based on EXIF data and filename patterns
  (e.g., BurstMode tag, SequenceNumber, filename patterns like IMG_001_BURST001)
- Soft criteria: Estimation based on timestamp proximity and visual similarity
  (e.g., photos within 2 seconds of each other from the same camera)

By default, only hard criteria rules are enabled.
"""

from __future__ import annotations

import logging
import os
import re
from collections import defaultdict
from collections.abc import Callable, Sequence
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Any

from api.metadata.datetime_rules import rules_json
from api.metadata.tags import Tags

if TYPE_CHECKING:
    from api.models.photo import Photo

logger = logging.getLogger(__name__)

# The longest pause between two frames of one burst, for the rules that do not
# set ``interval_ms`` (the EXIF rules) and the soft rule's default.
DEFAULT_BURST_INTERVAL_MS = 2000

# Canon's ContinuousDrive codes of single-frame drive modes (``exiftool -listx``:
# 0 Single, 2 Movie, 6 Silent Single, 9 Single, Silent); every other code is a
# continuous mode. The exif service reads with ``-n``, so the codes arrive.
_SINGLE_FRAME_DRIVE_CODES = frozenset({0, 2, 6, 9})
# MakerNotes:SequenceNumber of a photo outside a sequence: 0 = Single and
# 255 / 65535 = n/a (Sony and FujiFilm tables).
_NO_SEQUENCE_POSITION = frozenset({0, 255, 65535})
_OFF_WORDS = frozenset({"", "0", "off", "no", "false", "n/a"})


def _tag_code(value: object) -> int | None:
    """The integer an ExifTool value stands for, or None for a printed word."""
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str) and value.strip().isdigit():
        return int(value.strip())
    return None


def burst_mode_is_on(value: object) -> bool:
    """Whether a MakerNotes:BurstMode value is a burst: any mode but Off (0)."""
    if value is None:
        return False
    code = _tag_code(value)
    if code is not None:
        return code != 0
    return str(value).strip().lower() not in _OFF_WORDS


def continuous_drive_is_on(value: object) -> bool:
    """Whether a Canon MakerNotes:ContinuousDrive value is a continuous mode."""
    if value is None:
        return False
    code = _tag_code(value)
    if code is not None:
        return code not in _SINGLE_FRAME_DRIVE_CODES
    text = str(value).strip().lower()
    return text.startswith("continuous") or text == "on"


def sequence_position(value: object) -> int | None:
    """A frame's MakerNotes:SequenceNumber in its burst, None for a single shot."""
    if value is None:
        return None
    code = _tag_code(value)
    if code is None or code < 0 or code in _NO_SEQUENCE_POSITION:
        return None
    return code


def capture_time(photo: Photo) -> datetime | None:
    """When ``photo`` was taken, to the sub-second where the camera says.

    ``exif_timestamp`` holds whole seconds; ``exif_timestamp_subsec`` holds
    the digits of EXIF:SubSecTimeOriginal, a decimal fraction ("5" and "500"
    are both half a second).
    """
    timestamp = photo.exif_timestamp
    if timestamp is None or timestamp.microsecond:
        return timestamp
    digits = re.match(r"\d+", (photo.exif_timestamp_subsec or "").strip())
    if digits is None:
        return timestamp
    fraction = float("0." + digits.group())
    return timestamp + timedelta(microseconds=round(fraction * 1_000_000))


def camera_of(photo: Photo) -> str | None:
    """The camera that took ``photo``: its model, and its serial number if read.

    Not the make: photos scanned before the make was imported (#2265) have
    none, and a burst must not split between rescanned and older photos.
    """
    metadata = photo.metadata if hasattr(photo, "metadata") else None
    if metadata is None or not metadata.camera_model:
        return None
    if metadata.serial_number:
        return f"{metadata.camera_model} #{metadata.serial_number}"
    return metadata.camera_model


def frame_order(photo: Photo) -> tuple[datetime, int, str]:
    """Sort key for the frames of a burst: capture time, then camera counters."""
    taken = capture_time(photo) or photo.added_on
    number = photo.image_sequence_number
    path = photo.main_file.path if photo.main_file else ""
    return (taken, -1 if number is None else number, path)


def split_into_bursts(
    photos: Sequence[Photo],
    interval: timedelta | None,
    position: Callable[[Photo], int | None] | None = None,
) -> list[list[Photo]]:
    """``photos`` in frame order, cut where a frame comes more than ``interval``
    after the previous one or where its ``position`` (sequence number) does
    not rise, as when the camera starts a new burst. With ``interval`` None
    the capture times do not cut.
    """
    bursts: list[list[Photo]] = []
    previous: Photo | None = None
    for photo in sorted(photos, key=frame_order):
        if previous is None or _starts_new_burst(previous, photo, interval, position):
            bursts.append([photo])
        else:
            bursts[-1].append(photo)
        previous = photo
    return bursts


def _starts_new_burst(
    previous: Photo,
    photo: Photo,
    interval: timedelta | None,
    position: Callable[[Photo], int | None] | None,
) -> bool:
    if interval is not None:
        before, after = capture_time(previous), capture_time(photo)
        if before is None or after is None or after - before > interval:
            return True
    if position is not None:
        before_number, after_number = position(previous), position(photo)
        if (
            before_number is not None
            and after_number is not None
            and after_number <= before_number
        ):
            return True
    return False


class BurstRuleTypes:
    """Types of burst detection rules."""

    # Hard criteria (deterministic)
    EXIF_BURST_MODE = "exif_burst_mode"
    EXIF_SEQUENCE_NUMBER = "exif_sequence_number"
    FILENAME_PATTERN = "filename_pattern"

    # Soft criteria (estimation)
    TIMESTAMP_PROXIMITY = "timestamp_proximity"
    VISUAL_SIMILARITY = "visual_similarity"


class BurstRuleCategory:
    """Categories for burst detection rules."""

    HARD = "hard"  # Deterministic (EXIF, filenames)
    SOFT = "soft"  # Estimation (timestamps, visual similarity)


# Predefined filename patterns for burst detection
BURST_FILENAME_PATTERNS = {
    # Pattern name: (regex, description)
    "burst_suffix": (
        r"_BURST\d+",
        "Files with _BURST followed by numbers (e.g., IMG_001_BURST001.jpg)",
    ),
    "sequence_suffix": (
        r"_\d{3,}$",
        "Files ending with 3+ digit sequence number (e.g., IMG_001.jpg, IMG_002.jpg)",
    ),
    "bracketed_sequence": (
        r"\(\d+\)$",
        "Files with bracketed numbers at end (e.g., photo (1).jpg, photo (2).jpg)",
    ),
    "samsung_burst": (r"_\d{3}_COVER", "Samsung burst cover images"),
    "iphone_burst": (r"IMG_\d{4}_\d+", "iPhone burst sequence pattern"),
}


class BurstDetectionRule:
    """
    A rule for detecting burst sequences.

    Each rule has:
    - id: Unique identifier
    - name: Human-readable name
    - rule_type: One of BurstRuleTypes
    - category: 'hard' or 'soft' (for UI grouping)
    - enabled: Whether the rule is active
    - is_default: Whether this is a default rule
    - Type-specific parameters (e.g., interval_ms for timestamp_proximity)

    Additionally, each rule can have conditions:
    - condition_path: Regex to match full path
    - condition_filename: Regex to match filename
    - condition_exif: Format: "TAG_NAME//regex_pattern"
    """

    def __init__(self, params: dict[str, Any]) -> None:
        self.id = params.get("id")
        self.name = params.get("name", "Unnamed rule")
        self.rule_type = params["rule_type"]
        self.category = params.get("category", BurstRuleCategory.HARD)
        self.enabled = params.get("enabled", True)
        self.is_default = params.get("is_default", True)
        self.params = params

    def get_required_exif_tags(self) -> set[str]:
        """Return set of EXIF tags needed by this rule."""
        tags: set[str] = set()

        # Add condition tag if present
        condition_exif = self.params.get("condition_exif")
        if condition_exif:
            tag_name = condition_exif.split("//", maxsplit=1)[0]
            tags.add(tag_name)

        # Add rule-specific tags
        if self.rule_type == BurstRuleTypes.EXIF_BURST_MODE:
            tags.add(Tags.BURST_MODE)
            tags.add(Tags.CONTINUOUS_DRIVE)
        elif self.rule_type == BurstRuleTypes.EXIF_SEQUENCE_NUMBER:
            tags.add(Tags.SEQUENCE_NUMBER)

        return tags

    def burst_interval(self) -> timedelta | None:
        """The longest pause within one burst of this rule, or None when the
        rule's group key alone makes the burst (filename patterns)."""
        if self.rule_type in (
            BurstRuleTypes.EXIF_BURST_MODE,
            BurstRuleTypes.EXIF_SEQUENCE_NUMBER,
        ):
            return timedelta(
                milliseconds=self.params.get("interval_ms", DEFAULT_BURST_INTERVAL_MS)
            )
        return None

    def _check_condition_path(self, path: str) -> bool:
        """Check if path matches condition_path regex."""
        condition = self.params.get("condition_path")
        if condition:
            return re.search(condition, path) is not None
        return True

    def _check_condition_filename(self, path: str) -> bool:
        """Check if filename matches condition_filename regex."""
        condition = self.params.get("condition_filename")
        if condition:
            filename = os.path.basename(path)
            return re.search(condition, filename) is not None
        return True

    def _check_condition_exif(self, exif_tags: dict[str, Any]) -> bool:
        """Check if EXIF tag value matches condition_exif pattern."""
        condition = self.params.get("condition_exif")
        if not condition:
            return True

        parts = condition.split("//", maxsplit=1)
        if len(parts) != 2:
            logger.warning("Invalid condition_exif format: %s", condition)
            return False

        tag_name, pattern = parts
        tag_value = exif_tags.get(tag_name)
        if not tag_value:
            return False
        return re.search(pattern, str(tag_value)) is not None

    def check_conditions(self, path: str, exif_tags: dict[str, Any]) -> bool:
        """Check all conditions for this rule."""
        return (
            self._check_condition_path(path)
            and self._check_condition_filename(path)
            and self._check_condition_exif(exif_tags)
        )

    def is_burst_photo(
        self, photo: Photo, exif_tags: dict[str, Any]
    ) -> tuple[bool, str | None]:
        """
        Check if a photo is part of a burst sequence according to this rule.

        Args:
            photo: Photo model instance
            exif_tags: Dict of EXIF tag name -> value

        Returns:
            Tuple of (is_burst: bool, group_key: str or None)
            group_key can be used to group photos into the same burst
        """
        if not self.enabled:
            return False, None

        path = photo.main_file.path if photo.main_file else ""

        if not self.check_conditions(path, exif_tags):
            return False, None

        if self.rule_type == BurstRuleTypes.EXIF_BURST_MODE:
            return self._check_exif_burst_mode(photo, exif_tags)
        elif self.rule_type == BurstRuleTypes.EXIF_SEQUENCE_NUMBER:
            return self._check_exif_sequence_number(photo, exif_tags)
        elif self.rule_type == BurstRuleTypes.FILENAME_PATTERN:
            return self._check_filename_pattern(photo, exif_tags)
        else:
            # Soft rules don't use is_burst_photo - they use group_by_proximity
            return False, None

    def _check_exif_burst_mode(
        self, photo: Photo, exif_tags: dict[str, Any]
    ) -> tuple[bool, str | None]:
        """Check if EXIF BurstMode or ContinuousDrive indicates burst.

        The group key is the camera; ``split_into_bursts`` cuts its frames
        into bursts on the capture time (``burst_interval``).
        """
        if not (
            burst_mode_is_on(exif_tags.get(Tags.BURST_MODE))
            or continuous_drive_is_on(exif_tags.get(Tags.CONTINUOUS_DRIVE))
        ):
            return False, None
        if photo.exif_timestamp is None:
            return True, None
        return True, f"burst_{camera_of(photo) or 'unknown'}"

    def _check_exif_sequence_number(
        self, photo: Photo, exif_tags: dict[str, Any]
    ) -> tuple[bool, str | None]:
        """Check if the photo is a numbered frame of a sequence.

        Grouped like ``_check_exif_burst_mode``; ``split_into_bursts`` also
        starts a new burst where the number does not rise.
        """
        if sequence_position(exif_tags.get(Tags.SEQUENCE_NUMBER)) is None:
            return False, None
        if photo.exif_timestamp is None:
            return True, None
        return True, f"seq_{camera_of(photo) or 'unknown'}"

    def _check_filename_pattern(
        self, photo: Photo, exif_tags: dict[str, Any]
    ) -> tuple[bool, str | None]:
        """Check if filename matches burst pattern."""
        if not photo.main_file:
            return False, None

        filename = os.path.basename(photo.main_file.path)
        basename = os.path.splitext(filename)[0]

        # Get pattern type from params, default to checking all patterns
        pattern_type = self.params.get("pattern_type", "all")
        custom_pattern = self.params.get("custom_pattern")

        if custom_pattern:
            if re.search(custom_pattern, basename):
                # Extract base name for grouping (remove trailing numbers/burst suffix)
                base = re.sub(r"(_BURST\d+|_\d{3,}|\(\d+\))$", "", basename)
                directory = os.path.dirname(photo.main_file.path)
                group_key = f"filename_{directory}_{base}"
                return True, group_key
        elif pattern_type == "all":
            # Check all predefined patterns
            for pattern_name, (pattern, _) in BURST_FILENAME_PATTERNS.items():
                if re.search(pattern, basename, re.IGNORECASE):
                    base = re.sub(
                        r"(_BURST\d+|_\d{3,}|\(\d+\)|_COVER)$",
                        "",
                        basename,
                        flags=re.IGNORECASE,
                    )
                    directory = os.path.dirname(photo.main_file.path)
                    group_key = f"filename_{directory}_{base}"
                    return True, group_key
        # Check specific pattern
        elif pattern_type in BURST_FILENAME_PATTERNS:
            pattern, _ = BURST_FILENAME_PATTERNS[pattern_type]
            if re.search(pattern, basename, re.IGNORECASE):
                base = re.sub(
                    r"(_BURST\d+|_\d{3,}|\(\d+\)|_COVER)$",
                    "",
                    basename,
                    flags=re.IGNORECASE,
                )
                directory = os.path.dirname(photo.main_file.path)
                group_key = f"filename_{directory}_{base}"
                return True, group_key

        return False, None


def check_filename_pattern(
    photo: Photo, pattern_type: str = "any"
) -> tuple[bool, str | None]:
    """
    Check if a photo's filename matches a burst pattern.

    Standalone function for testing and external use.

    Args:
        photo: Photo model instance with main_file
        pattern_type: "any" to check all patterns, or specific pattern name
                     (e.g., "burst_suffix", "sequence_suffix", "bracketed_sequence",
                      "samsung_burst", "iphone_burst")

    Returns:
        Tuple of (matches: bool, group_key: str or None)
        group_key can be used to group photos into the same burst
    """
    if not photo.main_file:
        return False, None

    filename = os.path.basename(photo.main_file.path)
    basename = os.path.splitext(filename)[0]
    directory = os.path.dirname(photo.main_file.path)

    if pattern_type in {"any", "all"}:
        # Check all predefined patterns
        for pattern_name, (pattern, _) in BURST_FILENAME_PATTERNS.items():
            if re.search(pattern, basename, re.IGNORECASE):
                base = re.sub(
                    r"(_BURST\d+|_\d{3,}|\(\d+\)|_COVER)$",
                    "",
                    basename,
                    flags=re.IGNORECASE,
                )
                group_key = f"filename_{directory}_{base}"
                return True, group_key
    # Check specific pattern
    elif pattern_type in BURST_FILENAME_PATTERNS:
        pattern, _ = BURST_FILENAME_PATTERNS[pattern_type]
        if re.search(pattern, basename, re.IGNORECASE):
            base = re.sub(
                r"(_BURST\d+|_\d{3,}|\(\d+\)|_COVER)$",
                "",
                basename,
                flags=re.IGNORECASE,
            )
            group_key = f"filename_{directory}_{base}"
            return True, group_key

    return False, None


def group_photos_by_timestamp(
    photos: Sequence[Photo],
    interval_ms: int = DEFAULT_BURST_INTERVAL_MS,
    require_same_camera: bool = True,
) -> list[list[Photo]]:
    """
    Group photos by timestamp proximity (soft criterion).

    Frames whose capture times (to the sub-second) follow each other within
    ``interval_ms`` form a burst. With ``require_same_camera`` each camera's
    photos are grouped on their own, so two people shooting at the same
    moment get two bursts; photos without a camera model form their own set.

    Returns:
        The groups of two photos or more, each in frame order, by first frame.
    """
    by_camera: defaultdict[str | None, list[Photo]] = defaultdict(list)
    for photo in photos:
        if photo.exif_timestamp is None:
            continue
        by_camera[camera_of(photo) if require_same_camera else None].append(photo)

    interval = timedelta(milliseconds=interval_ms)
    groups = [
        burst
        for same_camera in by_camera.values()
        for burst in split_into_bursts(same_camera, interval)
        if len(burst) >= 2
    ]
    return sorted(groups, key=lambda burst: frame_order(burst[0]))


def group_photos_by_visual_similarity(
    photos: Sequence[Photo], similarity_threshold: int = 15
) -> list[list[Photo]]:
    """
    Group photos by visual similarity (soft criterion).

    Uses perceptual hash comparison to group visually similar photos.

    Args:
        photos: List of Photo objects
        similarity_threshold: Maximum hamming distance (lower = more similar)

    Returns:
        List of lists, each inner list is a group of visually similar Photo objects
    """
    from api.duplicates.perceptual_hash import hamming_distance

    if not photos:
        return []

    # Filter photos with perceptual hashes
    photos_with_hash = [p for p in photos if p.perceptual_hash]

    if len(photos_with_hash) < 2:
        return []

    # Simple clustering: group consecutive similar photos
    groups: list[list[Photo]] = []
    current_group = [photos_with_hash[0]]

    for i in range(1, len(photos_with_hash)):
        photo = photos_with_hash[i]
        prev_photo = photos_with_hash[i - 1]

        distance = hamming_distance(photo.perceptual_hash, prev_photo.perceptual_hash)

        if distance <= similarity_threshold:
            current_group.append(photo)
        else:
            if len(current_group) >= 2:
                groups.append(current_group)
            current_group = [photo]

    if len(current_group) >= 2:
        groups.append(current_group)

    return groups


# Default rules configuration
# Hard criteria rules (enabled by default)
DEFAULT_HARD_RULES: list[dict[str, Any]] = [
    {
        "id": 1,
        "name": "EXIF Burst Mode Tag",
        "rule_type": BurstRuleTypes.EXIF_BURST_MODE,
        "category": BurstRuleCategory.HARD,
        "enabled": True,
        "is_default": True,
        "description": "Detects photos where camera was in burst mode (using MakerNotes:BurstMode or MakerNotes:ContinuousDrive EXIF tags)",
    },
    {
        "id": 2,
        "name": "EXIF Sequence Number",
        "rule_type": BurstRuleTypes.EXIF_SEQUENCE_NUMBER,
        "category": BurstRuleCategory.HARD,
        "enabled": True,
        "is_default": True,
        "description": "Groups photos by EXIF sequence number (MakerNotes:SequenceNumber) taken at the same time",
    },
    {
        "id": 3,
        "name": "Filename Burst Pattern",
        "rule_type": BurstRuleTypes.FILENAME_PATTERN,
        "category": BurstRuleCategory.HARD,
        "enabled": True,
        "is_default": True,
        "pattern_type": "all",
        "description": "Detects burst sequences from filename patterns (e.g., IMG_001_BURST001, photo (1), photo (2))",
    },
]

# Soft criteria rules (disabled by default)
DEFAULT_SOFT_RULES: list[dict[str, Any]] = [
    {
        "id": 101,
        "name": "Timestamp Proximity",
        "rule_type": BurstRuleTypes.TIMESTAMP_PROXIMITY,
        "category": BurstRuleCategory.SOFT,
        "enabled": False,
        "is_default": True,
        "interval_ms": 2000,
        "require_same_camera": True,
        "description": "Groups photos taken within a short time interval (configurable, default 2 seconds)",
    },
    {
        "id": 102,
        "name": "Visual Similarity",
        "rule_type": BurstRuleTypes.VISUAL_SIMILARITY,
        "category": BurstRuleCategory.SOFT,
        "enabled": False,
        "is_default": True,
        "similarity_threshold": 15,
        "description": "Groups visually similar consecutive photos using perceptual hash comparison",
    },
]

# Other available rules (not included by default)
OTHER_RULES: list[dict[str, Any]] = [
    {
        "id": 4,
        "name": "Filename Burst Suffix Only",
        "rule_type": BurstRuleTypes.FILENAME_PATTERN,
        "category": BurstRuleCategory.HARD,
        "enabled": False,
        "is_default": False,
        "pattern_type": "burst_suffix",
        "description": "Only detect files with explicit _BURST suffix in filename",
    },
    {
        "id": 5,
        "name": "Custom Filename Pattern",
        "rule_type": BurstRuleTypes.FILENAME_PATTERN,
        "category": BurstRuleCategory.HARD,
        "enabled": False,
        "is_default": False,
        "pattern_type": "custom",
        "custom_pattern": "",
        "description": "Use a custom regex pattern to match burst filenames",
    },
    {
        "id": 103,
        "name": "Timestamp Proximity (Loose)",
        "rule_type": BurstRuleTypes.TIMESTAMP_PROXIMITY,
        "category": BurstRuleCategory.SOFT,
        "enabled": False,
        "is_default": False,
        "interval_ms": 5000,
        "require_same_camera": False,
        "description": "Groups photos taken within 5 seconds, regardless of camera",
    },
]


def get_default_burst_detection_rules() -> list[dict[str, Any]]:
    """Get default burst detection rules as JSON-serializable list."""
    return DEFAULT_HARD_RULES + DEFAULT_SOFT_RULES


def get_all_predefined_burst_rules() -> list[dict[str, Any]]:
    """Get all predefined burst detection rules (default + optional)."""
    return DEFAULT_HARD_RULES + DEFAULT_SOFT_RULES + OTHER_RULES


# Pre-computed JSON strings for API responses
DEFAULT_RULES_JSON = rules_json(get_default_burst_detection_rules())
PREDEFINED_RULES_JSON = rules_json(get_all_predefined_burst_rules())


def as_rules(configs: list[dict[str, Any]]) -> list[BurstDetectionRule]:
    """Convert list of rule configs to list of BurstDetectionRule objects."""
    return [BurstDetectionRule(config) for config in configs]


def get_hard_rules(rules: list[BurstDetectionRule]) -> list[BurstDetectionRule]:
    """Filter to only hard criteria rules."""
    return [r for r in rules if r.category == BurstRuleCategory.HARD and r.enabled]


def get_soft_rules(rules: list[BurstDetectionRule]) -> list[BurstDetectionRule]:
    """Filter to only soft criteria rules."""
    return [r for r in rules if r.category == BurstRuleCategory.SOFT and r.enabled]


def get_enabled_rules(rules: list[BurstDetectionRule]) -> list[BurstDetectionRule]:
    """Filter to only enabled rules."""
    return [r for r in rules if r.enabled]
