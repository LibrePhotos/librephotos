"""
Comprehensive tests for Burst Detection Rules engine.

Tests cover:
- BurstDetectionRule class functionality
- Rule condition checking (path, filename, EXIF)
- Hard criteria rules (EXIF burst mode, sequence number, filename patterns)
- Soft criteria rules (timestamp proximity, visual similarity)
- Rule filtering and grouping
- Edge cases and error handling
"""

import re
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

from django.test import TestCase

from api.burst_detection_rules import (
    BURST_FILENAME_PATTERNS,
    BurstDetectionRule,
    BurstRuleCategory,
    BurstRuleTypes,
    DEFAULT_HARD_RULES,
    DEFAULT_SOFT_RULES,
    as_rules,
    get_all_predefined_burst_rules,
    get_default_burst_detection_rules,
    get_enabled_rules,
    get_hard_rules,
    get_soft_rules,
    group_photos_by_timestamp,
    group_photos_by_visual_similarity,
)


class BurstRuleTypesTestCase(TestCase):
    """Tests for BurstRuleTypes constants."""

    def test_hard_criteria_types(self):
        """Test hard criteria type constants exist."""
        self.assertEqual(BurstRuleTypes.EXIF_BURST_MODE, "exif_burst_mode")
        self.assertEqual(BurstRuleTypes.EXIF_SEQUENCE_NUMBER, "exif_sequence_number")
        self.assertEqual(BurstRuleTypes.FILENAME_PATTERN, "filename_pattern")

    def test_soft_criteria_types(self):
        """Test soft criteria type constants exist."""
        self.assertEqual(BurstRuleTypes.TIMESTAMP_PROXIMITY, "timestamp_proximity")
        self.assertEqual(BurstRuleTypes.VISUAL_SIMILARITY, "visual_similarity")


class BurstRuleCategoryTestCase(TestCase):
    """Tests for BurstRuleCategory constants."""

    def test_categories(self):
        """Test category constants."""
        self.assertEqual(BurstRuleCategory.HARD, "hard")
        self.assertEqual(BurstRuleCategory.SOFT, "soft")


class BurstFilenamePatternTestCase(TestCase):
    """Tests for predefined filename patterns."""

    def test_burst_suffix_pattern(self):
        """Test _BURST pattern matching."""
        pattern, _ = BURST_FILENAME_PATTERNS["burst_suffix"]
        self.assertIsNotNone(re.search(pattern, "IMG_001_BURST001"))
        self.assertIsNotNone(re.search(pattern, "photo_BURST123"))
        self.assertIsNone(re.search(pattern, "IMG_001"))
        self.assertIsNone(re.search(pattern, "BURST_photo"))

    def test_sequence_suffix_pattern(self):
        """Test sequence number pattern matching."""
        pattern, _ = BURST_FILENAME_PATTERNS["sequence_suffix"]
        self.assertIsNotNone(re.search(pattern, "IMG_001"))
        self.assertIsNotNone(re.search(pattern, "photo_1234"))
        self.assertIsNone(re.search(pattern, "IMG_01"))  # Only 2 digits
        self.assertIsNone(re.search(pattern, "IMG_001_extra"))  # Not at end

    def test_bracketed_sequence_pattern(self):
        """Test (1), (2) pattern matching."""
        pattern, _ = BURST_FILENAME_PATTERNS["bracketed_sequence"]
        self.assertIsNotNone(re.search(pattern, "photo (1)"))
        self.assertIsNotNone(re.search(pattern, "image (99)"))
        self.assertIsNotNone(re.search(pattern, "photo(1)"))  # Pattern allows no space
        self.assertIsNone(re.search(pattern, "(1) photo"))  # Not at end

    def test_samsung_burst_pattern(self):
        """Test Samsung burst pattern."""
        pattern, _ = BURST_FILENAME_PATTERNS["samsung_burst"]
        self.assertIsNotNone(re.search(pattern, "IMG_001_COVER"))
        self.assertIsNotNone(re.search(pattern, "photo_123_COVER"))
        self.assertIsNone(re.search(pattern, "IMG_COVER"))

    def test_iphone_burst_pattern(self):
        """Test iPhone burst pattern."""
        pattern, _ = BURST_FILENAME_PATTERNS["iphone_burst"]
        self.assertIsNotNone(re.search(pattern, "IMG_1234_5"))
        self.assertIsNotNone(re.search(pattern, "IMG_0001_123"))
        self.assertIsNone(re.search(pattern, "IMG_123_5"))  # Only 3 digits


class BurstDetectionRuleTestCase(TestCase):
    """Tests for BurstDetectionRule class."""

    def test_create_rule_with_minimal_params(self):
        """Test creating rule with minimal required params."""
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.EXIF_BURST_MODE,
        })
        self.assertEqual(rule.id, 1)
        self.assertEqual(rule.rule_type, BurstRuleTypes.EXIF_BURST_MODE)
        self.assertEqual(rule.name, "Unnamed rule")
        self.assertTrue(rule.enabled)
        self.assertTrue(rule.is_default)

    def test_create_rule_with_all_params(self):
        """Test creating rule with all params."""
        rule = BurstDetectionRule({
            "id": 42,
            "name": "My Custom Rule",
            "rule_type": BurstRuleTypes.FILENAME_PATTERN,
            "category": BurstRuleCategory.HARD,
            "enabled": False,
            "is_default": False,
            "custom_pattern": r"_BURST\d+",
        })
        self.assertEqual(rule.id, 42)
        self.assertEqual(rule.name, "My Custom Rule")
        self.assertEqual(rule.rule_type, BurstRuleTypes.FILENAME_PATTERN)
        self.assertEqual(rule.category, BurstRuleCategory.HARD)
        self.assertFalse(rule.enabled)
        self.assertFalse(rule.is_default)
        self.assertEqual(rule.params["custom_pattern"], r"_BURST\d+")

    def test_get_required_exif_tags_burst_mode(self):
        """Test required tags for burst mode rule."""
        from api.exif_tags import Tags
        
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.EXIF_BURST_MODE,
        })
        tags = rule.get_required_exif_tags()
        self.assertIn(Tags.BURST_MODE, tags)
        self.assertIn(Tags.CONTINUOUS_DRIVE, tags)

    def test_get_required_exif_tags_sequence_number(self):
        """Test required tags for sequence number rule."""
        from api.exif_tags import Tags
        
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.EXIF_SEQUENCE_NUMBER,
        })
        tags = rule.get_required_exif_tags()
        self.assertIn(Tags.SEQUENCE_NUMBER, tags)
        self.assertIn(Tags.IMAGE_NUMBER, tags)

    def test_get_required_exif_tags_with_condition(self):
        """Test required tags includes condition tag."""
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.FILENAME_PATTERN,
            "condition_exif": "EXIF:Make//Canon",
        })
        tags = rule.get_required_exif_tags()
        self.assertIn("EXIF:Make", tags)


class RuleConditionTestCase(TestCase):
    """Tests for rule condition checking."""

    def test_check_condition_path_matches(self):
        """Test path condition matching."""
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.FILENAME_PATTERN,
            "condition_path": r"/photos/bursts/",
        })
        self.assertTrue(rule._check_condition_path("/photos/bursts/img001.jpg"))
        self.assertFalse(rule._check_condition_path("/photos/normal/img001.jpg"))

    def test_check_condition_path_no_condition(self):
        """Test path condition when not set."""
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.FILENAME_PATTERN,
        })
        self.assertTrue(rule._check_condition_path("/any/path/works.jpg"))

    def test_check_condition_filename_matches(self):
        """Test filename condition matching."""
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.FILENAME_PATTERN,
            "condition_filename": r"^IMG_\d+",
        })
        self.assertTrue(rule._check_condition_filename("/photos/IMG_001.jpg"))
        self.assertFalse(rule._check_condition_filename("/photos/DSC_001.jpg"))

    def test_check_condition_exif_matches(self):
        """Test EXIF condition matching."""
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.EXIF_BURST_MODE,
            "condition_exif": "EXIF:Make//Canon",
        })
        self.assertTrue(rule._check_condition_exif({"EXIF:Make": "Canon EOS"}))
        self.assertFalse(rule._check_condition_exif({"EXIF:Make": "Nikon"}))
        self.assertFalse(rule._check_condition_exif({}))

    def test_check_condition_exif_invalid_format(self):
        """Test EXIF condition with invalid format."""
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.EXIF_BURST_MODE,
            "condition_exif": "InvalidFormat",  # Missing //
        })
        self.assertFalse(rule._check_condition_exif({"EXIF:Make": "Canon"}))

    def test_check_all_conditions_combined(self):
        """Test checking all conditions together."""
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.FILENAME_PATTERN,
            "condition_path": r"/bursts/",
            "condition_filename": r"^IMG",
            "condition_exif": "EXIF:Make//Canon",
        })
        
        # All match
        self.assertTrue(rule.check_conditions(
            "/bursts/IMG_001.jpg",
            {"EXIF:Make": "Canon"}
        ))
        
        # Path doesn't match
        self.assertFalse(rule.check_conditions(
            "/normal/IMG_001.jpg",
            {"EXIF:Make": "Canon"}
        ))
        
        # Filename doesn't match
        self.assertFalse(rule.check_conditions(
            "/bursts/DSC_001.jpg",
            {"EXIF:Make": "Canon"}
        ))
        
        # EXIF doesn't match
        self.assertFalse(rule.check_conditions(
            "/bursts/IMG_001.jpg",
            {"EXIF:Make": "Nikon"}
        ))


class ExifBurstModeRuleTestCase(TestCase):
    """Tests for EXIF burst mode detection."""

    def _create_mock_photo(self, path="/photos/test.jpg", timestamp=None):
        """Create a mock photo object."""
        photo = MagicMock()
        photo.main_file = MagicMock()
        photo.main_file.path = path
        photo.exif_timestamp = timestamp or datetime.now()
        return photo

    def test_burst_mode_on(self):
        """Test detection with BurstMode = 1."""
        from api.exif_tags import Tags
        
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.EXIF_BURST_MODE,
            "enabled": True,
        })
        photo = self._create_mock_photo()
        
        is_burst, group_key = rule.is_burst_photo(photo, {Tags.BURST_MODE: "1"})
        
        self.assertTrue(is_burst)
        self.assertIsNotNone(group_key)
        self.assertIn("burst_", group_key)

    def test_burst_mode_on_string(self):
        """Test detection with BurstMode = 'On'."""
        from api.exif_tags import Tags
        
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.EXIF_BURST_MODE,
            "enabled": True,
        })
        photo = self._create_mock_photo()
        
        is_burst, _ = rule.is_burst_photo(photo, {Tags.BURST_MODE: "On"})
        self.assertTrue(is_burst)

    def test_continuous_drive_on(self):
        """Test detection with ContinuousDrive."""
        from api.exif_tags import Tags
        
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.EXIF_BURST_MODE,
            "enabled": True,
        })
        photo = self._create_mock_photo()
        
        is_burst, _ = rule.is_burst_photo(photo, {Tags.CONTINUOUS_DRIVE: "Continuous"})
        self.assertTrue(is_burst)

    def test_burst_mode_off(self):
        """Test no detection when BurstMode = 0."""
        from api.exif_tags import Tags
        
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.EXIF_BURST_MODE,
            "enabled": True,
        })
        photo = self._create_mock_photo()
        
        is_burst, _ = rule.is_burst_photo(photo, {Tags.BURST_MODE: "0"})
        self.assertFalse(is_burst)

    def test_disabled_rule_returns_false(self):
        """Test disabled rule always returns False."""
        from api.exif_tags import Tags
        
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.EXIF_BURST_MODE,
            "enabled": False,
        })
        photo = self._create_mock_photo()
        
        is_burst, _ = rule.is_burst_photo(photo, {Tags.BURST_MODE: "1"})
        self.assertFalse(is_burst)


class ExifSequenceNumberRuleTestCase(TestCase):
    """Tests for EXIF sequence number detection."""

    def _create_mock_photo(self, path="/photos/test.jpg", timestamp=None):
        """Create a mock photo object."""
        photo = MagicMock()
        photo.main_file = MagicMock()
        photo.main_file.path = path
        photo.exif_timestamp = timestamp or datetime.now()
        return photo

    def test_sequence_number_detected(self):
        """Test detection with valid sequence number."""
        from api.exif_tags import Tags
        
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.EXIF_SEQUENCE_NUMBER,
            "enabled": True,
        })
        photo = self._create_mock_photo()
        
        is_burst, group_key = rule.is_burst_photo(photo, {Tags.SEQUENCE_NUMBER: "5"})
        
        self.assertTrue(is_burst)
        self.assertIsNotNone(group_key)
        self.assertIn("seq_", group_key)

    def test_sequence_number_zero(self):
        """Test detection with sequence number 0."""
        from api.exif_tags import Tags
        
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.EXIF_SEQUENCE_NUMBER,
            "enabled": True,
        })
        photo = self._create_mock_photo()
        
        is_burst, _ = rule.is_burst_photo(photo, {Tags.SEQUENCE_NUMBER: "0"})
        self.assertTrue(is_burst)

    def test_invalid_sequence_number(self):
        """Test no detection with invalid sequence number."""
        from api.exif_tags import Tags
        
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.EXIF_SEQUENCE_NUMBER,
            "enabled": True,
        })
        photo = self._create_mock_photo()
        
        is_burst, _ = rule.is_burst_photo(photo, {Tags.SEQUENCE_NUMBER: "not_a_number"})
        self.assertFalse(is_burst)

    def test_no_sequence_number(self):
        """Test no detection when tag is missing."""
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.EXIF_SEQUENCE_NUMBER,
            "enabled": True,
        })
        photo = self._create_mock_photo()
        
        is_burst, _ = rule.is_burst_photo(photo, {})
        self.assertFalse(is_burst)


class FilenamePatternRuleTestCase(TestCase):
    """Tests for filename pattern detection."""

    def _create_mock_photo(self, path):
        """Create a mock photo object."""
        photo = MagicMock()
        photo.main_file = MagicMock()
        photo.main_file.path = path
        photo.exif_timestamp = datetime.now()
        return photo

    def test_burst_suffix_detected(self):
        """Test _BURST suffix detection."""
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.FILENAME_PATTERN,
            "enabled": True,
            "pattern_type": "all",
        })
        photo = self._create_mock_photo("/photos/IMG_001_BURST001.jpg")
        
        is_burst, group_key = rule.is_burst_photo(photo, {})
        
        self.assertTrue(is_burst)
        self.assertIsNotNone(group_key)
        self.assertIn("filename_", group_key)

    def test_sequence_suffix_detected(self):
        """Test sequence suffix detection."""
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.FILENAME_PATTERN,
            "enabled": True,
            "pattern_type": "all",
        })
        photo = self._create_mock_photo("/photos/IMG_001.jpg")
        
        is_burst, _ = rule.is_burst_photo(photo, {})
        self.assertTrue(is_burst)

    def test_bracketed_sequence_detected(self):
        """Test (1), (2) pattern detection."""
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.FILENAME_PATTERN,
            "enabled": True,
            "pattern_type": "all",
        })
        photo = self._create_mock_photo("/photos/photo (1).jpg")
        
        is_burst, _ = rule.is_burst_photo(photo, {})
        self.assertTrue(is_burst)

    def test_custom_pattern(self):
        """Test custom regex pattern."""
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.FILENAME_PATTERN,
            "enabled": True,
            "custom_pattern": r"_HDR\d+",
        })
        photo = self._create_mock_photo("/photos/IMG_HDR001.jpg")
        
        is_burst, _ = rule.is_burst_photo(photo, {})
        self.assertTrue(is_burst)

    def test_specific_pattern_type(self):
        """Test specific pattern type selection."""
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.FILENAME_PATTERN,
            "enabled": True,
            "pattern_type": "burst_suffix",
        })
        
        # Should match burst suffix
        photo1 = self._create_mock_photo("/photos/IMG_BURST001.jpg")
        is_burst, _ = rule.is_burst_photo(photo1, {})
        self.assertTrue(is_burst)
        
        # Should NOT match sequence suffix (different pattern type)
        photo2 = self._create_mock_photo("/photos/IMG_001.jpg")
        is_burst, _ = rule.is_burst_photo(photo2, {})
        self.assertFalse(is_burst)

    def test_no_pattern_match(self):
        """Test no detection when pattern doesn't match."""
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.FILENAME_PATTERN,
            "enabled": True,
            "pattern_type": "burst_suffix",
        })
        photo = self._create_mock_photo("/photos/normal_photo.jpg")
        
        is_burst, _ = rule.is_burst_photo(photo, {})
        self.assertFalse(is_burst)

    def test_no_main_file(self):
        """Test handling of photo without main_file."""
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.FILENAME_PATTERN,
            "enabled": True,
        })
        photo = MagicMock()
        photo.main_file = None
        
        is_burst, _ = rule.is_burst_photo(photo, {})
        self.assertFalse(is_burst)

    def test_group_key_contains_directory(self):
        """Test group key includes directory for proper grouping."""
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.FILENAME_PATTERN,
            "enabled": True,
            "pattern_type": "all",
        })
        
        photo1 = self._create_mock_photo("/dir1/IMG_001.jpg")
        photo2 = self._create_mock_photo("/dir2/IMG_001.jpg")
        
        _, key1 = rule.is_burst_photo(photo1, {})
        _, key2 = rule.is_burst_photo(photo2, {})
        
        # Keys should be different for different directories
        self.assertNotEqual(key1, key2)


class GroupPhotosByTimestampTestCase(TestCase):
    """Tests for timestamp proximity grouping."""

    def _create_mock_photo(self, timestamp, camera_make="Canon", camera_model="EOS"):
        """Create a mock photo with timestamp and metadata."""
        photo = MagicMock()
        photo.exif_timestamp = timestamp
        photo.metadata = MagicMock()
        photo.metadata.camera_make = camera_make
        photo.metadata.camera_model = camera_model
        return photo

    def test_group_consecutive_photos(self):
        """Test grouping photos within interval."""
        base_time = datetime(2024, 1, 1, 12, 0, 0)
        photos = [
            self._create_mock_photo(base_time),
            self._create_mock_photo(base_time + timedelta(milliseconds=500)),
            self._create_mock_photo(base_time + timedelta(milliseconds=1000)),
        ]
        
        groups = group_photos_by_timestamp(photos, interval_ms=2000)
        
        self.assertEqual(len(groups), 1)
        self.assertEqual(len(groups[0]), 3)

    def test_separate_groups_by_time_gap(self):
        """Test photos with time gap form separate groups."""
        base_time = datetime(2024, 1, 1, 12, 0, 0)
        photos = [
            self._create_mock_photo(base_time),
            self._create_mock_photo(base_time + timedelta(milliseconds=500)),
            # Gap of 5 seconds
            self._create_mock_photo(base_time + timedelta(seconds=5)),
            self._create_mock_photo(base_time + timedelta(seconds=5, milliseconds=500)),
        ]
        
        groups = group_photos_by_timestamp(photos, interval_ms=2000)
        
        self.assertEqual(len(groups), 2)
        self.assertEqual(len(groups[0]), 2)
        self.assertEqual(len(groups[1]), 2)

    def test_single_photo_not_grouped(self):
        """Test single photo doesn't form a group."""
        photos = [self._create_mock_photo(datetime.now())]
        
        groups = group_photos_by_timestamp(photos)
        
        self.assertEqual(len(groups), 0)

    def test_photos_without_timestamp_skipped(self):
        """Test photos without timestamp are skipped."""
        base_time = datetime(2024, 1, 1, 12, 0, 0)
        photos = [
            self._create_mock_photo(base_time),
            self._create_mock_photo(None),  # No timestamp
            self._create_mock_photo(base_time + timedelta(milliseconds=500)),
        ]
        
        groups = group_photos_by_timestamp(photos)
        
        # Should still group the two with timestamps
        self.assertEqual(len(groups), 1)
        self.assertEqual(len(groups[0]), 2)

    def test_empty_photo_list(self):
        """Test empty input returns empty list."""
        groups = group_photos_by_timestamp([])
        self.assertEqual(groups, [])

    def test_require_same_camera(self):
        """Test same camera requirement."""
        base_time = datetime(2024, 1, 1, 12, 0, 0)
        photos = [
            self._create_mock_photo(base_time, "Canon", "EOS"),
            self._create_mock_photo(base_time + timedelta(milliseconds=500), "Nikon", "D850"),
            self._create_mock_photo(base_time + timedelta(milliseconds=1000), "Canon", "EOS"),
        ]
        
        # With same camera requirement
        groups = group_photos_by_timestamp(photos, require_same_camera=True)
        
        # Different cameras break the group
        self.assertEqual(len(groups), 0)

    def test_without_camera_requirement(self):
        """Test grouping without camera requirement."""
        base_time = datetime(2024, 1, 1, 12, 0, 0)
        photos = [
            self._create_mock_photo(base_time, "Canon", "EOS"),
            self._create_mock_photo(base_time + timedelta(milliseconds=500), "Nikon", "D850"),
        ]
        
        groups = group_photos_by_timestamp(photos, require_same_camera=False)
        
        self.assertEqual(len(groups), 1)
        self.assertEqual(len(groups[0]), 2)

    def test_custom_interval(self):
        """Test custom interval setting."""
        base_time = datetime(2024, 1, 1, 12, 0, 0)
        photos = [
            self._create_mock_photo(base_time),
            self._create_mock_photo(base_time + timedelta(milliseconds=3000)),
        ]
        
        # Default 2000ms interval - should NOT group
        groups = group_photos_by_timestamp(photos, interval_ms=2000)
        self.assertEqual(len(groups), 0)
        
        # 5000ms interval - should group
        groups = group_photos_by_timestamp(photos, interval_ms=5000)
        self.assertEqual(len(groups), 1)


class GroupPhotosByVisualSimilarityTestCase(TestCase):
    """Tests for visual similarity grouping."""

    def _create_mock_photo_with_hash(self, phash):
        """Create a mock photo with perceptual hash."""
        photo = MagicMock()
        photo.perceptual_hash = phash
        return photo

    @patch("api.perceptual_hash.hamming_distance")
    def test_group_similar_photos(self, mock_hamming):
        """Test grouping visually similar photos."""
        # All photos are similar (distance <= 15)
        mock_hamming.return_value = 5
        
        photos = [
            self._create_mock_photo_with_hash("hash1"),
            self._create_mock_photo_with_hash("hash2"),
            self._create_mock_photo_with_hash("hash3"),
        ]
        
        groups = group_photos_by_visual_similarity(photos, similarity_threshold=15)
        
        self.assertEqual(len(groups), 1)
        self.assertEqual(len(groups[0]), 3)

    @patch("api.perceptual_hash.hamming_distance")
    def test_separate_dissimilar_photos(self, mock_hamming):
        """Test dissimilar photos form separate groups."""
        # Distance alternates between similar and dissimilar
        mock_hamming.side_effect = [5, 30, 5]  # similar, dissimilar, similar
        
        photos = [
            self._create_mock_photo_with_hash("hash1"),
            self._create_mock_photo_with_hash("hash2"),
            self._create_mock_photo_with_hash("hash3"),
            self._create_mock_photo_with_hash("hash4"),
        ]
        
        groups = group_photos_by_visual_similarity(photos)
        
        # First two group, then third and fourth group separately
        self.assertEqual(len(groups), 2)

    def test_photos_without_hash_filtered(self):
        """Test photos without hash are filtered out."""
        photos = [
            self._create_mock_photo_with_hash("hash1"),
            self._create_mock_photo_with_hash(None),
            self._create_mock_photo_with_hash("hash2"),
        ]
        
        # Mock hamming distance for the remaining two
        with patch("api.perceptual_hash.hamming_distance", return_value=5):
            groups = group_photos_by_visual_similarity(photos)
        
        self.assertEqual(len(groups), 1)
        self.assertEqual(len(groups[0]), 2)

    def test_empty_list(self):
        """Test empty input returns empty list."""
        groups = group_photos_by_visual_similarity([])
        self.assertEqual(groups, [])

    def test_single_photo_with_hash(self):
        """Test single photo doesn't form a group."""
        photos = [self._create_mock_photo_with_hash("hash1")]
        
        groups = group_photos_by_visual_similarity(photos)
        self.assertEqual(len(groups), 0)


class DefaultRulesTestCase(TestCase):
    """Tests for default rule configurations."""

    def test_default_hard_rules_count(self):
        """Test default hard rules are defined."""
        self.assertGreaterEqual(len(DEFAULT_HARD_RULES), 3)

    def test_default_soft_rules_count(self):
        """Test default soft rules are defined."""
        self.assertGreaterEqual(len(DEFAULT_SOFT_RULES), 2)

    def test_default_hard_rules_enabled(self):
        """Test default hard rules are enabled."""
        for rule in DEFAULT_HARD_RULES:
            self.assertTrue(rule.get("enabled", False))

    def test_default_soft_rules_disabled(self):
        """Test default soft rules are disabled."""
        for rule in DEFAULT_SOFT_RULES:
            self.assertFalse(rule.get("enabled", True))

    def test_all_default_rules_have_ids(self):
        """Test all default rules have unique IDs."""
        all_rules = DEFAULT_HARD_RULES + DEFAULT_SOFT_RULES
        ids = [r["id"] for r in all_rules]
        self.assertEqual(len(ids), len(set(ids)))

    def test_get_default_burst_detection_rules(self):
        """Test getting all default rules."""
        rules = get_default_burst_detection_rules()
        self.assertEqual(len(rules), len(DEFAULT_HARD_RULES) + len(DEFAULT_SOFT_RULES))

    def test_get_all_predefined_burst_rules(self):
        """Test getting all predefined rules including optional."""
        all_rules = get_all_predefined_burst_rules()
        self.assertGreater(len(all_rules), len(get_default_burst_detection_rules()))


class RuleFilteringTestCase(TestCase):
    """Tests for rule filtering functions."""

    def test_as_rules(self):
        """Test converting configs to rule objects."""
        configs = [
            {"id": 1, "rule_type": BurstRuleTypes.EXIF_BURST_MODE},
            {"id": 2, "rule_type": BurstRuleTypes.FILENAME_PATTERN},
        ]
        rules = as_rules(configs)
        
        self.assertEqual(len(rules), 2)
        self.assertIsInstance(rules[0], BurstDetectionRule)
        self.assertEqual(rules[0].id, 1)

    def test_get_hard_rules(self):
        """Test filtering hard rules."""
        rules = as_rules([
            {"id": 1, "rule_type": BurstRuleTypes.EXIF_BURST_MODE, "category": BurstRuleCategory.HARD, "enabled": True},
            {"id": 2, "rule_type": BurstRuleTypes.TIMESTAMP_PROXIMITY, "category": BurstRuleCategory.SOFT, "enabled": True},
            {"id": 3, "rule_type": BurstRuleTypes.FILENAME_PATTERN, "category": BurstRuleCategory.HARD, "enabled": False},
        ])
        
        hard_rules = get_hard_rules(rules)
        
        self.assertEqual(len(hard_rules), 1)
        self.assertEqual(hard_rules[0].id, 1)

    def test_get_soft_rules(self):
        """Test filtering soft rules."""
        rules = as_rules([
            {"id": 1, "rule_type": BurstRuleTypes.EXIF_BURST_MODE, "category": BurstRuleCategory.HARD, "enabled": True},
            {"id": 2, "rule_type": BurstRuleTypes.TIMESTAMP_PROXIMITY, "category": BurstRuleCategory.SOFT, "enabled": True},
        ])
        
        soft_rules = get_soft_rules(rules)
        
        self.assertEqual(len(soft_rules), 1)
        self.assertEqual(soft_rules[0].id, 2)

    def test_get_enabled_rules(self):
        """Test filtering enabled rules."""
        rules = as_rules([
            {"id": 1, "rule_type": BurstRuleTypes.EXIF_BURST_MODE, "enabled": True},
            {"id": 2, "rule_type": BurstRuleTypes.FILENAME_PATTERN, "enabled": False},
            {"id": 3, "rule_type": BurstRuleTypes.TIMESTAMP_PROXIMITY, "enabled": True},
        ])
        
        enabled = get_enabled_rules(rules)
        
        self.assertEqual(len(enabled), 2)
        self.assertIn(enabled[0].id, [1, 3])
        self.assertIn(enabled[1].id, [1, 3])


class EdgeCasesTestCase(TestCase):
    """Edge case tests for burst detection."""

    def test_rule_with_none_timestamp(self):
        """Test rule handling when photo has no timestamp."""
        from api.exif_tags import Tags
        
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.EXIF_BURST_MODE,
            "enabled": True,
        })
        
        photo = MagicMock()
        photo.main_file = MagicMock()
        photo.main_file.path = "/photos/test.jpg"
        photo.exif_timestamp = None
        
        is_burst, group_key = rule.is_burst_photo(photo, {Tags.BURST_MODE: "1"})
        
        # Should still detect burst, but group_key may be None
        self.assertTrue(is_burst)

    def test_group_key_consistency(self):
        """Test that same photos always produce same group key."""
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.FILENAME_PATTERN,
            "enabled": True,
            "pattern_type": "all",
        })
        
        photo = MagicMock()
        photo.main_file = MagicMock()
        photo.main_file.path = "/photos/IMG_001_BURST001.jpg"
        photo.exif_timestamp = datetime(2024, 1, 1, 12, 0, 0)
        
        _, key1 = rule.is_burst_photo(photo, {})
        _, key2 = rule.is_burst_photo(photo, {})
        
        self.assertEqual(key1, key2)

    def test_empty_exif_tags(self):
        """Test handling empty EXIF tags dict."""
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.EXIF_BURST_MODE,
            "enabled": True,
        })
        
        photo = MagicMock()
        photo.main_file = MagicMock()
        photo.main_file.path = "/photos/test.jpg"
        
        is_burst, _ = rule.is_burst_photo(photo, {})
        self.assertFalse(is_burst)

    def test_special_characters_in_filename(self):
        """Test filename pattern with special characters."""
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.FILENAME_PATTERN,
            "enabled": True,
            "pattern_type": "all",
        })
        
        photo = MagicMock()
        photo.main_file = MagicMock()
        photo.main_file.path = "/photos/my photo (1).jpg"
        photo.exif_timestamp = datetime.now()
        
        is_burst, _ = rule.is_burst_photo(photo, {})
        self.assertTrue(is_burst)

    def test_case_insensitive_pattern_matching(self):
        """Test patterns match case-insensitively."""
        rule = BurstDetectionRule({
            "id": 1,
            "rule_type": BurstRuleTypes.FILENAME_PATTERN,
            "enabled": True,
            "pattern_type": "all",
        })
        
        # Lowercase
        photo1 = MagicMock()
        photo1.main_file = MagicMock()
        photo1.main_file.path = "/photos/img_burst001.jpg"
        photo1.exif_timestamp = datetime.now()
        
        # Uppercase
        photo2 = MagicMock()
        photo2.main_file = MagicMock()
        photo2.main_file.path = "/photos/IMG_BURST001.jpg"
        photo2.exif_timestamp = datetime.now()
        
        is_burst1, _ = rule.is_burst_photo(photo1, {})
        is_burst2, _ = rule.is_burst_photo(photo2, {})
        
        self.assertTrue(is_burst1)
        self.assertTrue(is_burst2)
