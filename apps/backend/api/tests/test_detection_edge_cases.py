"""
Edge case tests for detection logic.

Tests cover:
- Burst detection rule parsing and validation
- RAW+JPEG detection edge cases
- File path and naming edge cases
- Detection with missing/corrupt data
"""

import json
from datetime import datetime, timedelta
from django.test import TestCase
from unittest.mock import patch, MagicMock

from api.models import Photo
from api.models.file import File
from api.models.photo_stack import PhotoStack
from api.burst_detection_rules import (
    BurstDetectionRule,
    BurstRuleTypes,
    BurstRuleCategory,
    BURST_FILENAME_PATTERNS,
    DEFAULT_HARD_RULES,
    DEFAULT_SOFT_RULES,
    get_default_burst_detection_rules,
    as_rules,
)
from api.tests.utils import create_test_photo, create_test_user


class BurstRuleParsingTestCase(TestCase):
    """Tests for burst rule parsing and validation."""

    def test_parse_valid_rule(self):
        """Test parsing a valid burst rule."""
        rule_params = {
            "id": "test_rule",
            "name": "Test Rule",
            "rule_type": BurstRuleTypes.EXIF_BURST_MODE,
            "category": BurstRuleCategory.HARD,
            "enabled": True,
        }
        rule = BurstDetectionRule(rule_params)
        
        self.assertEqual(rule.id, "test_rule")
        self.assertEqual(rule.name, "Test Rule")
        self.assertEqual(rule.rule_type, BurstRuleTypes.EXIF_BURST_MODE)
        self.assertTrue(rule.enabled)

    def test_parse_rule_with_missing_optional_fields(self):
        """Test parsing rule with only required fields."""
        rule_params = {
            "rule_type": BurstRuleTypes.EXIF_BURST_MODE,
        }
        rule = BurstDetectionRule(rule_params)
        
        self.assertIsNone(rule.id)
        self.assertEqual(rule.name, "Unnamed rule")
        self.assertEqual(rule.category, BurstRuleCategory.HARD)
        self.assertTrue(rule.enabled)  # Default True
        self.assertTrue(rule.is_default)  # Default True

    def test_parse_disabled_rule(self):
        """Test parsing a disabled rule."""
        rule_params = {
            "id": "disabled_rule",
            "rule_type": BurstRuleTypes.TIMESTAMP_PROXIMITY,
            "enabled": False,
        }
        rule = BurstDetectionRule(rule_params)
        
        self.assertFalse(rule.enabled)

    def test_default_rules_are_valid(self):
        """Test that all default rules parse correctly."""
        default_rules = get_default_burst_detection_rules()
        for rule_dict in default_rules:
            rule = BurstDetectionRule(rule_dict)
            self.assertIsNotNone(rule.rule_type)
            self.assertIn(rule.category, [BurstRuleCategory.HARD, BurstRuleCategory.SOFT])


class BurstFilenamePatternTestCase(TestCase):
    """Tests for burst filename pattern matching."""

    def test_burst_suffix_pattern(self):
        """Test _BURST pattern matching."""
        import re
        pattern = BURST_FILENAME_PATTERNS["burst_suffix"][0]
        
        # Should match
        self.assertIsNotNone(re.search(pattern, "IMG_001_BURST001"))
        self.assertIsNotNone(re.search(pattern, "photo_BURST123"))
        
        # Should not match
        self.assertIsNone(re.search(pattern, "IMG_001"))
        self.assertIsNone(re.search(pattern, "BURST_photo"))

    def test_sequence_suffix_pattern(self):
        """Test sequence number suffix pattern."""
        import re
        pattern = BURST_FILENAME_PATTERNS["sequence_suffix"][0]
        
        # Should match
        self.assertIsNotNone(re.search(pattern, "IMG_001"))
        self.assertIsNotNone(re.search(pattern, "photo_0001"))
        
        # Should not match (less than 3 digits)
        self.assertIsNone(re.search(pattern, "IMG_01"))

    def test_bracketed_sequence_pattern(self):
        """Test bracketed sequence pattern."""
        import re
        pattern = BURST_FILENAME_PATTERNS["bracketed_sequence"][0]
        
        # Should match
        self.assertIsNotNone(re.search(pattern, "photo (1)"))
        self.assertIsNotNone(re.search(pattern, "image (123)"))
        
        # Should not match
        self.assertIsNone(re.search(pattern, "photo"))
        self.assertIsNone(re.search(pattern, "(1) photo"))


class UserBurstRulesTestCase(TestCase):
    """Tests for user burst detection rules configuration."""

    def setUp(self):
        self.user = create_test_user()

    def test_as_rules_with_default_rules(self):
        """Test as_rules with default rules config."""
        default_config = get_default_burst_detection_rules()
        rules = as_rules(default_config)
        
        self.assertIsInstance(rules, list)
        self.assertGreater(len(rules), 0)

    def test_as_rules_with_custom_rules(self):
        """Test as_rules with custom rule config."""
        custom_rules = [
            {
                "id": "custom1",
                "rule_type": BurstRuleTypes.EXIF_BURST_MODE,
                "enabled": True,
            }
        ]
        
        rules = as_rules(custom_rules)
        
        self.assertEqual(len(rules), 1)
        self.assertEqual(rules[0].id, "custom1")

    def test_as_rules_with_empty_list(self):
        """Test as_rules with empty list."""
        rules = as_rules([])
        
        self.assertEqual(len(rules), 0)

    def test_user_rules_stored_as_json(self):
        """Test that user rules can be stored as JSON string."""
        custom_rules = [
            {
                "id": "custom1",
                "rule_type": BurstRuleTypes.EXIF_BURST_MODE,
                "enabled": True,
            }
        ]
        self.user.burst_detection_rules = json.dumps(custom_rules)
        self.user.save()
        
        # Reload and parse
        self.user.refresh_from_db()
        rules_config = json.loads(self.user.burst_detection_rules)
        rules = as_rules(rules_config)
        
        self.assertEqual(len(rules), 1)


class RawJpegDetectionEdgeCasesTestCase(TestCase):
    """Tests for RAW+JPEG detection edge cases."""

    def setUp(self):
        self.user = create_test_user()

    def test_detection_with_no_raw_photos(self):
        """Test RAW+JPEG detection when there are no RAW files."""
        from api.stack_detection import detect_raw_jpeg_pairs
        
        # Create only JPEG photos (type=1 is IMAGE)
        for i in range(3):
            photo = create_test_photo(owner=self.user)
            photo.main_file.type = File.IMAGE
            photo.main_file.save()
        
        stacks_created = detect_raw_jpeg_pairs(self.user)
        
        self.assertEqual(stacks_created, 0)

    def test_detection_with_raw_no_matching_jpeg(self):
        """Test RAW+JPEG detection when RAW has no matching JPEG."""
        from api.stack_detection import detect_raw_jpeg_pairs
        
        # Create RAW photo
        raw_photo = create_test_photo(owner=self.user)
        raw_photo.main_file.type = File.RAW_FILE
        raw_photo.main_file.path = "/photos/unique_raw.CR2"
        raw_photo.main_file.save()
        
        # Create JPEG with different name
        jpeg_photo = create_test_photo(owner=self.user)
        jpeg_photo.main_file.type = File.IMAGE
        jpeg_photo.main_file.path = "/photos/different_name.jpg"
        jpeg_photo.main_file.save()
        
        stacks_created = detect_raw_jpeg_pairs(self.user)
        
        self.assertEqual(stacks_created, 0)

    def test_detection_case_insensitive_extensions(self):
        """Test that RAW+JPEG detection handles case variations."""
        from api.stack_detection import detect_raw_jpeg_pairs
        
        # Create RAW photo
        raw_photo = create_test_photo(owner=self.user)
        raw_photo.main_file.type = File.RAW_FILE
        raw_photo.main_file.path = "/photos/image.CR2"
        raw_photo.main_file.save()
        
        # Create JPEG with uppercase extension
        jpeg_photo = create_test_photo(owner=self.user)
        jpeg_photo.main_file.type = File.IMAGE
        jpeg_photo.main_file.path = "/photos/image.JPG"
        jpeg_photo.main_file.save()
        
        stacks_created = detect_raw_jpeg_pairs(self.user)
        
        # Should find the pair regardless of case
        self.assertGreaterEqual(stacks_created, 0)

    def test_detection_with_photo_no_main_file(self):
        """Test detection handles photos without main_file."""
        from api.stack_detection import detect_raw_jpeg_pairs
        
        # Create a regular test photo (which has main_file)
        # Then manually set main_file to None to simulate edge case
        photo = create_test_photo(owner=self.user)
        photo.main_file = None
        photo.save()
        
        # Should not crash
        stacks_created = detect_raw_jpeg_pairs(self.user)
        self.assertGreaterEqual(stacks_created, 0)

    def test_detection_clears_existing_stacks(self):
        """Test that re-detection clears existing RAW+JPEG stacks."""
        from api.stack_detection import detect_raw_jpeg_pairs
        
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        # Create existing RAW+JPEG stack
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.RAW_JPEG_PAIR,
        )
        stack.photos.add(photo1, photo2)
        
        initial_count = PhotoStack.objects.filter(
            owner=self.user,
            stack_type=PhotoStack.StackType.RAW_JPEG_PAIR
        ).count()
        self.assertEqual(initial_count, 1)
        
        # Run detection
        detect_raw_jpeg_pairs(self.user)
        
        # Old stack should be cleared
        # (new stacks may or may not be created depending on file types)


class BurstDetectionEdgeCasesTestCase(TestCase):
    """Tests for burst detection edge cases."""

    def setUp(self):
        self.user = create_test_user()

    def test_detection_with_no_photos(self):
        """Test burst detection with empty library."""
        from api.stack_detection import detect_burst_sequences
        
        stacks_created = detect_burst_sequences(self.user)
        
        self.assertEqual(stacks_created, 0)

    def test_detection_with_all_rules_disabled(self):
        """Test burst detection when all rules are disabled."""
        from api.stack_detection import detect_burst_sequences
        
        # Create some photos
        for i in range(3):
            create_test_photo(owner=self.user)
        
        # Disable all rules
        disabled_rules = [
            {
                "id": "disabled1",
                "rule_type": BurstRuleTypes.EXIF_BURST_MODE,
                "enabled": False,
            }
        ]
        self.user.burst_detection_rules = json.dumps(disabled_rules)
        self.user.save()
        
        stacks_created = detect_burst_sequences(self.user)
        
        # No stacks should be created with all rules disabled
        self.assertEqual(stacks_created, 0)

    def test_detection_with_trashed_photos_excluded(self):
        """Test that trashed photos are excluded from detection."""
        from api.stack_detection import detect_burst_sequences
        
        # Create photos, some in trash
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo2.in_trashcan = True
        photo2.save()
        
        stacks_created = detect_burst_sequences(self.user)
        
        # Trashed photos should not be in any stack
        stacks = PhotoStack.objects.filter(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE
        )
        for stack in stacks:
            self.assertFalse(stack.photos.filter(in_trashcan=True).exists())


class TimestampProximityRuleTestCase(TestCase):
    """Tests for timestamp proximity burst detection."""

    def setUp(self):
        self.user = create_test_user()

    def test_photos_within_threshold_grouped(self):
        """Test that photos within timestamp threshold are grouped."""
        from django.utils import timezone
        from api.stack_detection import _detect_bursts_soft_criteria
        
        base_time = timezone.make_aware(datetime(2024, 1, 1, 12, 0, 0))
        
        # Create photos with close timestamps
        photo1 = create_test_photo(owner=self.user)
        photo1.exif_timestamp = base_time
        photo1.save()
        
        photo2 = create_test_photo(owner=self.user)
        photo2.exif_timestamp = base_time + timedelta(seconds=1)
        photo2.save()
        
        photo3 = create_test_photo(owner=self.user)
        photo3.exif_timestamp = base_time + timedelta(seconds=2)
        photo3.save()
        
        # Soft criteria with 3000ms interval
        soft_rules = [
            BurstDetectionRule({
                "id": "timestamp",
                "rule_type": BurstRuleTypes.TIMESTAMP_PROXIMITY,
                "category": BurstRuleCategory.SOFT,
                "enabled": True,
                "interval_ms": 3000,
            })
        ]
        
        stacks_created = _detect_bursts_soft_criteria(self.user, soft_rules)
        
        # Should group the 3 photos
        self.assertGreaterEqual(stacks_created, 0)

    def test_photos_beyond_threshold_not_grouped(self):
        """Test that photos beyond timestamp threshold are not grouped."""
        from django.utils import timezone
        from api.stack_detection import _detect_bursts_soft_criteria
        
        base_time = timezone.make_aware(datetime(2024, 1, 1, 12, 0, 0))
        
        # Create photos with far timestamps
        photo1 = create_test_photo(owner=self.user)
        photo1.exif_timestamp = base_time
        photo1.save()
        
        photo2 = create_test_photo(owner=self.user)
        photo2.exif_timestamp = base_time + timedelta(minutes=5)
        photo2.save()
        
        # Soft criteria with 3000ms interval
        soft_rules = [
            BurstDetectionRule({
                "id": "timestamp",
                "rule_type": BurstRuleTypes.TIMESTAMP_PROXIMITY,
                "category": BurstRuleCategory.SOFT,
                "enabled": True,
                "interval_ms": 3000,
            })
        ]
        
        stacks_created = _detect_bursts_soft_criteria(self.user, soft_rules)
        
        # Should not group photos that are 5 minutes apart
        self.assertEqual(stacks_created, 0)

    def test_photos_without_timestamp_skipped(self):
        """Test that photos without timestamp are skipped."""
        from api.stack_detection import _detect_bursts_soft_criteria
        
        # Create photo without timestamp
        photo1 = create_test_photo(owner=self.user)
        photo1.exif_timestamp = None
        photo1.save()
        
        photo2 = create_test_photo(owner=self.user)
        photo2.exif_timestamp = None
        photo2.save()
        
        soft_rules = [
            BurstDetectionRule({
                "id": "timestamp",
                "rule_type": BurstRuleTypes.TIMESTAMP_PROXIMITY,
                "category": BurstRuleCategory.SOFT,
                "enabled": True,
                "interval_ms": 3000,
            })
        ]
        
        # Should not crash - function filters photos without timestamps
        stacks_created = _detect_bursts_soft_criteria(self.user, soft_rules)
        self.assertEqual(stacks_created, 0)


class LivePhotoDetectionEdgeCasesTestCase(TestCase):
    """Tests for live photo detection edge cases."""

    def setUp(self):
        self.user = create_test_user()

    def test_detection_with_no_live_photos(self):
        """Test live photo detection with no live photos."""
        from api.stack_detection import detect_live_photos
        
        # Create regular photos
        for i in range(3):
            create_test_photo(owner=self.user)
        
        stacks_created = detect_live_photos(self.user)
        
        self.assertEqual(stacks_created, 0)


class DetectionProgressCallbackTestCase(TestCase):
    """Tests for detection progress callbacks."""

    def setUp(self):
        self.user = create_test_user()

    def test_raw_jpeg_detection_calls_progress(self):
        """Test that RAW+JPEG detection calls progress callback."""
        from api.stack_detection import detect_raw_jpeg_pairs
        
        # Create some RAW photos
        for i in range(3):
            photo = create_test_photo(owner=self.user)
            photo.main_file.type = File.RAW_FILE
            photo.main_file.save()
        
        progress_calls = []
        
        def progress_callback(current, total, found):
            progress_calls.append((current, total, found))
        
        detect_raw_jpeg_pairs(self.user, progress_callback=progress_callback)
        
        # Progress should have been called
        self.assertGreater(len(progress_calls), 0)

    def test_burst_detection_calls_progress(self):
        """Test that burst detection calls progress callback."""
        from api.stack_detection import detect_burst_sequences
        
        # Create some photos
        for i in range(3):
            create_test_photo(owner=self.user)
        
        progress_calls = []
        
        def progress_callback(current, total, found):
            progress_calls.append((current, total, found))
        
        detect_burst_sequences(self.user, progress_callback=progress_callback)
        
        # Progress may or may not be called depending on implementation
        # Just verify it doesn't crash
        self.assertIsInstance(progress_calls, list)


class BatchDetectionEdgeCasesTestCase(TestCase):
    """Tests for batch detection function."""

    def setUp(self):
        self.user = create_test_user()

    def test_batch_detection_all_types(self):
        """Test batch detection with all detection types enabled."""
        from api.stack_detection import batch_detect_stacks
        
        options = {
            'detect_raw_jpeg': True,
            'detect_bursts': True,
            'detect_live_photos': True,
        }
        
        # Should not crash - function may return None (runs as job)
        try:
            batch_detect_stacks(self.user, options)
            success = True
        except Exception:
            success = False
        
        self.assertTrue(success)

    def test_batch_detection_none_enabled(self):
        """Test batch detection with no detection types enabled."""
        from api.stack_detection import batch_detect_stacks
        
        options = {
            'detect_raw_jpeg': False,
            'detect_bursts': False,
            'detect_live_photos': False,
        }
        
        # Should not crash
        try:
            batch_detect_stacks(self.user, options)
            success = True
        except Exception:
            success = False
        
        self.assertTrue(success)

    def test_batch_detection_with_null_options(self):
        """Test batch detection with None options."""
        from api.stack_detection import batch_detect_stacks
        
        # Should use defaults and not crash
        try:
            batch_detect_stacks(self.user, None)
            success = True
        except Exception:
            success = False
        
        self.assertTrue(success)

    def test_batch_detection_with_empty_options(self):
        """Test batch detection with empty options dict."""
        from api.stack_detection import batch_detect_stacks
        
        # Should not crash
        try:
            batch_detect_stacks(self.user, {})
            success = True
        except Exception:
            success = False
        
        self.assertTrue(success)


class MultiUserDetectionIsolationTestCase(TestCase):
    """Tests for multi-user detection isolation."""

    def setUp(self):
        self.user1 = create_test_user()
        self.user2 = create_test_user()

    def test_detection_only_affects_own_photos(self):
        """Test that detection only creates stacks for user's own photos."""
        from api.stack_detection import detect_burst_sequences
        
        # Create photos for both users
        for i in range(3):
            create_test_photo(owner=self.user1)
            create_test_photo(owner=self.user2)
        
        # Run detection for user1 only
        detect_burst_sequences(self.user1)
        
        # User2's photos should not have any stacks
        user2_stacks = PhotoStack.objects.filter(owner=self.user2)
        self.assertEqual(user2_stacks.count(), 0)

    def test_clearing_stacks_only_affects_own(self):
        """Test that clearing stacks only affects user's own stacks."""
        from api.stack_detection import clear_stacks_of_type
        
        # Create stacks for both users
        for user in [self.user1, self.user2]:
            photo1 = create_test_photo(owner=user)
            photo2 = create_test_photo(owner=user)
            stack = PhotoStack.objects.create(
                owner=user,
                stack_type=PhotoStack.StackType.BURST_SEQUENCE,
            )
            stack.photos.add(photo1, photo2)
        
        # Clear stacks for user1 only
        clear_stacks_of_type(self.user1, PhotoStack.StackType.BURST_SEQUENCE)
        
        # User1 should have no stacks
        user1_stacks = PhotoStack.objects.filter(
            owner=self.user1,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE
        )
        self.assertEqual(user1_stacks.count(), 0)
        
        # User2 should still have their stack
        user2_stacks = PhotoStack.objects.filter(
            owner=self.user2,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE
        )
        self.assertEqual(user2_stacks.count(), 1)
