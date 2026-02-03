"""
Burst detection rules module for grouping photos taken in rapid succession.

This module provides a rules-based system for detecting burst sequences,
following the same pattern as date_time_extractor.py. Rules are stored
as JSON in each user's profile and applied sequentially.

Rules are divided into two categories:
- Hard criteria: Deterministic detection based on EXIF data and filename patterns
  (e.g., BurstMode tag, SequenceNumber, filename patterns like IMG_001_BURST001)
- Soft criteria: Estimation based on timestamp proximity and visual similarity
  (e.g., photos within 2 seconds of each other from the same camera)

By default, only hard criteria rules are enabled.
"""

import json
import os
import re
from datetime import timedelta

from api.exif_tags import Tags
from api.util import logger


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
        "Files with _BURST followed by numbers (e.g., IMG_001_BURST001.jpg)"
    ),
    "sequence_suffix": (
        r"_\d{3,}$",
        "Files ending with 3+ digit sequence number (e.g., IMG_001.jpg, IMG_002.jpg)"
    ),
    "bracketed_sequence": (
        r"\(\d+\)$",
        "Files with bracketed numbers at end (e.g., photo (1).jpg, photo (2).jpg)"
    ),
    "samsung_burst": (
        r"_\d{3}_COVER",
        "Samsung burst cover images"
    ),
    "iphone_burst": (
        r"IMG_\d{4}_\d+",
        "iPhone burst sequence pattern"
    ),
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

    def __init__(self, params):
        self.id = params.get("id")
        self.name = params.get("name", "Unnamed rule")
        self.rule_type = params["rule_type"]
        self.category = params.get("category", BurstRuleCategory.HARD)
        self.enabled = params.get("enabled", True)
        self.is_default = params.get("is_default", True)
        self.params = params

    def get_required_exif_tags(self):
        """Return set of EXIF tags needed by this rule."""
        tags = set()
        
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
            tags.add(Tags.IMAGE_NUMBER)
            tags.add(Tags.SUBSEC_TIME_ORIGINAL)
        
        return tags

    def _check_condition_path(self, path):
        """Check if path matches condition_path regex."""
        condition = self.params.get("condition_path")
        if condition:
            return re.search(condition, path) is not None
        return True

    def _check_condition_filename(self, path):
        """Check if filename matches condition_filename regex."""
        condition = self.params.get("condition_filename")
        if condition:
            filename = os.path.basename(path)
            return re.search(condition, filename) is not None
        return True

    def _check_condition_exif(self, exif_tags):
        """Check if EXIF tag value matches condition_exif pattern."""
        condition = self.params.get("condition_exif")
        if not condition:
            return True
        
        parts = condition.split("//", maxsplit=1)
        if len(parts) != 2:
            logger.warning(f"Invalid condition_exif format: {condition}")
            return False
        
        tag_name, pattern = parts
        tag_value = exif_tags.get(tag_name)
        if not tag_value:
            return False
        return re.search(pattern, str(tag_value)) is not None

    def check_conditions(self, path, exif_tags):
        """Check all conditions for this rule."""
        return (
            self._check_condition_path(path)
            and self._check_condition_filename(path)
            and self._check_condition_exif(exif_tags)
        )

    def is_burst_photo(self, photo, exif_tags):
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

    def _check_exif_burst_mode(self, photo, exif_tags):
        """Check if EXIF BurstMode or ContinuousDrive indicates burst."""
        burst_mode = exif_tags.get(Tags.BURST_MODE)
        continuous_drive = exif_tags.get(Tags.CONTINUOUS_DRIVE)
        
        # BurstMode: 1 = On (Canon, etc.)
        if burst_mode and str(burst_mode) in ("1", "On", "True", "Yes"):
            # Group by timestamp (rounded to second) + camera model
            camera = exif_tags.get(Tags.CAMERA, "unknown")
            timestamp = photo.exif_timestamp
            if timestamp:
                group_key = f"burst_{camera}_{timestamp.strftime('%Y%m%d_%H%M%S')}"
                return True, group_key
            return True, None
        
        # ContinuousDrive: Continuous, etc.
        if continuous_drive and continuous_drive.lower() in ("continuous", "on", "1"):
            camera = exif_tags.get(Tags.CAMERA, "unknown")
            timestamp = photo.exif_timestamp
            if timestamp:
                group_key = f"burst_{camera}_{timestamp.strftime('%Y%m%d_%H%M%S')}"
                return True, group_key
            return True, None
        
        return False, None

    def _check_exif_sequence_number(self, photo, exif_tags):
        """Check if photo has sequence number indicating burst."""
        sequence_num = exif_tags.get(Tags.SEQUENCE_NUMBER)
        
        # If we have a sequence number, it's likely part of a burst
        if sequence_num is not None:
            try:
                int(sequence_num)  # Validate it's a valid number
                # Sequence numbers suggest burst
                # Group by directory + base timestamp
                camera = exif_tags.get(Tags.CAMERA, "unknown")
                timestamp = photo.exif_timestamp
                if timestamp:
                    # Round to same second for grouping
                    group_key = f"seq_{camera}_{timestamp.strftime('%Y%m%d_%H%M%S')}"
                    return True, group_key
                return True, None
            except (ValueError, TypeError):
                pass
        
        return False, None

    def _check_filename_pattern(self, photo, exif_tags):
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
                    base = re.sub(r"(_BURST\d+|_\d{3,}|\(\d+\)|_COVER)$", "", basename, flags=re.IGNORECASE)
                    directory = os.path.dirname(photo.main_file.path)
                    group_key = f"filename_{directory}_{base}"
                    return True, group_key
        else:
            # Check specific pattern
            if pattern_type in BURST_FILENAME_PATTERNS:
                pattern, _ = BURST_FILENAME_PATTERNS[pattern_type]
                if re.search(pattern, basename, re.IGNORECASE):
                    base = re.sub(r"(_BURST\d+|_\d{3,}|\(\d+\)|_COVER)$", "", basename, flags=re.IGNORECASE)
                    directory = os.path.dirname(photo.main_file.path)
                    group_key = f"filename_{directory}_{base}"
                    return True, group_key
        
        return False, None


def check_filename_pattern(photo, pattern_type="any"):
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
    
    if pattern_type == "any" or pattern_type == "all":
        # Check all predefined patterns
        for pattern_name, (pattern, _) in BURST_FILENAME_PATTERNS.items():
            if re.search(pattern, basename, re.IGNORECASE):
                base = re.sub(r"(_BURST\d+|_\d{3,}|\(\d+\)|_COVER)$", "", basename, flags=re.IGNORECASE)
                group_key = f"filename_{directory}_{base}"
                return True, group_key
    else:
        # Check specific pattern
        if pattern_type in BURST_FILENAME_PATTERNS:
            pattern, _ = BURST_FILENAME_PATTERNS[pattern_type]
            if re.search(pattern, basename, re.IGNORECASE):
                base = re.sub(r"(_BURST\d+|_\d{3,}|\(\d+\)|_COVER)$", "", basename, flags=re.IGNORECASE)
                group_key = f"filename_{directory}_{base}"
                return True, group_key
    
    return False, None


def group_photos_by_timestamp(photos, interval_ms=2000, require_same_camera=True):
    """
    Group photos by timestamp proximity (soft criterion).
    
    Args:
        photos: QuerySet of Photo objects ordered by exif_timestamp
        interval_ms: Maximum milliseconds between consecutive burst shots
        require_same_camera: If True, only group photos from same camera
        
    Returns:
        List of lists, each inner list is a group of Photo objects
    """
    if not photos:
        return []
    
    interval = timedelta(milliseconds=interval_ms)
    groups = []
    current_group = []
    prev_photo = None
    prev_camera = None
    
    for photo in photos:
        if not photo.exif_timestamp:
            continue
        
        # Get camera info for same-camera check
        camera = None
        if require_same_camera and hasattr(photo, 'metadata') and photo.metadata:
            camera = f"{photo.metadata.camera_make or ''}_{photo.metadata.camera_model or ''}"
        
        if prev_photo is None:
            current_group = [photo]
            prev_photo = photo
            prev_camera = camera
            continue
        
        # Check time difference
        time_diff = photo.exif_timestamp - prev_photo.exif_timestamp
        
        # Check if same camera (if required)
        same_camera = True
        if require_same_camera and camera and prev_camera:
            same_camera = (camera == prev_camera)
        
        if time_diff <= interval and same_camera:
            # Part of same burst
            current_group.append(photo)
        else:
            # End of current burst, save if we have a group
            if len(current_group) >= 2:
                groups.append(current_group)
            # Start new group
            current_group = [photo]
        
        prev_photo = photo
        prev_camera = camera
    
    # Don't forget the last group
    if len(current_group) >= 2:
        groups.append(current_group)
    
    return groups


def group_photos_by_visual_similarity(photos, similarity_threshold=15):
    """
    Group photos by visual similarity (soft criterion).
    
    Uses perceptual hash comparison to group visually similar photos.
    
    Args:
        photos: List of Photo objects
        similarity_threshold: Maximum hamming distance (lower = more similar)
        
    Returns:
        List of lists, each inner list is a group of visually similar Photo objects
    """
    from api.perceptual_hash import hamming_distance
    
    if not photos:
        return []
    
    # Filter photos with perceptual hashes
    photos_with_hash = [p for p in photos if p.perceptual_hash]
    
    if len(photos_with_hash) < 2:
        return []
    
    # Simple clustering: group consecutive similar photos
    groups = []
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
DEFAULT_HARD_RULES = [
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
DEFAULT_SOFT_RULES = [
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
OTHER_RULES = [
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


def get_default_burst_detection_rules():
    """Get default burst detection rules as JSON-serializable list."""
    return DEFAULT_HARD_RULES + DEFAULT_SOFT_RULES


def get_all_predefined_burst_rules():
    """Get all predefined burst detection rules (default + optional)."""
    return DEFAULT_HARD_RULES + DEFAULT_SOFT_RULES + OTHER_RULES


def _as_json(configs):
    """Convert rule configs to JSON string."""
    return json.dumps(configs, default=lambda x: x.__dict__)


# Pre-computed JSON strings for API responses
DEFAULT_RULES_JSON = _as_json(get_default_burst_detection_rules())
PREDEFINED_RULES_JSON = _as_json(get_all_predefined_burst_rules())


def as_rules(configs):
    """Convert list of rule configs to list of BurstDetectionRule objects."""
    return [BurstDetectionRule(config) for config in configs]


def get_hard_rules(rules):
    """Filter to only hard criteria rules."""
    return [r for r in rules if r.category == BurstRuleCategory.HARD and r.enabled]


def get_soft_rules(rules):
    """Filter to only soft criteria rules."""
    return [r for r in rules if r.category == BurstRuleCategory.SOFT and r.enabled]


def get_enabled_rules(rules):
    """Filter to only enabled rules."""
    return [r for r in rules if r.enabled]
