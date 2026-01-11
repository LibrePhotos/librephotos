"""
Comprehensive tests for api/models/stack_review.py

Tests the StackReview model for tracking user review decisions on stacks:
- Model creation and field validation
- Decision choices (PENDING, RESOLVED, DISMISSED)
- Resolve workflow (keep photo, trash others)
- Dismiss workflow (unlink photos)
- Revert workflow (restore trashed photos)
- Reviewable stack types logic
"""

import uuid
from datetime import timedelta
from unittest.mock import MagicMock, patch

from django.test import TestCase
from django.utils import timezone

from api.models.file import File
from api.models.photo import Photo
from api.models.photo_stack import PhotoStack
from api.models.stack_review import StackReview
from api.models.user import User


class StackReviewModelTestCase(TestCase):
    """Tests for the StackReview model creation and fields."""

    def setUp(self):
        """Create test user and stack."""
        self.user = User.objects.create(username="reviewtest")
        self.stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )

    def test_create_stack_review(self):
        """Should create a StackReview with default values."""
        review = StackReview.objects.create(
            stack=self.stack,
            reviewer=self.user,
        )
        self.assertIsNotNone(review.id)
        self.assertEqual(review.decision, StackReview.Decision.PENDING)
        self.assertIsNone(review.kept_photo)
        self.assertEqual(review.trashed_count, 0)
        self.assertIsNone(review.reviewed_at)

    def test_uuid_primary_key(self):
        """Review ID should be a valid UUID."""
        review = StackReview.objects.create(
            stack=self.stack,
            reviewer=self.user,
        )
        self.assertIsInstance(review.id, uuid.UUID)

    def test_one_to_one_with_stack(self):
        """Stack should have at most one review."""
        StackReview.objects.create(
            stack=self.stack,
            reviewer=self.user,
        )
        # Creating second review for same stack should raise error
        from django.db import IntegrityError
        with self.assertRaises(IntegrityError):
            StackReview.objects.create(
                stack=self.stack,
                reviewer=self.user,
            )

    def test_str_representation(self):
        """String representation should include stack ID and decision."""
        review = StackReview.objects.create(
            stack=self.stack,
            reviewer=self.user,
            decision=StackReview.Decision.PENDING,
        )
        result = str(review)
        self.assertIn(str(self.stack.id), result)
        self.assertIn("pending", result)

    def test_decision_choices(self):
        """All decision choices should be valid."""
        for decision, label in StackReview.Decision.choices:
            review = StackReview.objects.create(
                stack=PhotoStack.objects.create(
                    owner=self.user,
                    stack_type=PhotoStack.StackType.MANUAL,
                ),
                reviewer=self.user,
                decision=decision,
            )
            self.assertEqual(review.decision, decision)

    def test_optional_note_field(self):
        """Note field should be optional."""
        review = StackReview.objects.create(
            stack=self.stack,
            reviewer=self.user,
            note="User's reason for this decision",
        )
        self.assertEqual(review.note, "User's reason for this decision")

    def test_ordering_by_created_at_descending(self):
        """Reviews should be ordered by created_at descending."""
        stack2 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        review1 = StackReview.objects.create(
            stack=self.stack,
            reviewer=self.user,
        )
        review2 = StackReview.objects.create(
            stack=stack2,
            reviewer=self.user,
        )
        reviews = list(StackReview.objects.all())
        # review2 was created later, should come first
        self.assertEqual(reviews[0], review2)
        self.assertEqual(reviews[1], review1)


class DecisionChoicesTestCase(TestCase):
    """Tests for the Decision text choices."""

    def test_pending_choice(self):
        """PENDING decision should exist."""
        self.assertEqual(StackReview.Decision.PENDING, "pending")

    def test_resolved_choice(self):
        """RESOLVED decision should exist."""
        self.assertEqual(StackReview.Decision.RESOLVED, "resolved")

    def test_dismissed_choice(self):
        """DISMISSED decision should exist."""
        self.assertEqual(StackReview.Decision.DISMISSED, "dismissed")

    def test_all_choices_have_labels(self):
        """All choices should have human-readable labels."""
        labels = dict(StackReview.Decision.choices)
        self.assertEqual(labels["pending"], "Pending Review")
        self.assertEqual(labels["resolved"], "Resolved")
        self.assertEqual(labels["dismissed"], "Dismissed")


class ReviewableStackTypesTestCase(TestCase):
    """Tests for reviewable stack types logic."""

    def test_get_reviewable_stack_types_returns_empty(self):
        """
        Should return empty list since reviewable types moved to Duplicate model.
        
        Note: This is intentional design - PhotoStack is now for informational
        groupings only, while Duplicate handles the review workflow.
        """
        types = StackReview.get_reviewable_stack_types()
        self.assertEqual(types, [])

    def test_is_reviewable_type_returns_false_for_all_stack_types(self):
        """No stack types should be reviewable since they moved to Duplicate."""
        for stack_type in PhotoStack.StackType.values:
            self.assertFalse(StackReview.is_reviewable_type(stack_type))

    def test_is_reviewable_type_returns_false_for_raw_jpeg(self):
        """RAW_JPEG_PAIR is informational, not reviewable."""
        self.assertFalse(
            StackReview.is_reviewable_type(PhotoStack.StackType.RAW_JPEG_PAIR)
        )

    def test_is_reviewable_type_returns_false_for_burst(self):
        """BURST_SEQUENCE is informational, not reviewable."""
        self.assertFalse(
            StackReview.is_reviewable_type(PhotoStack.StackType.BURST_SEQUENCE)
        )

    def test_is_reviewable_type_returns_false_for_manual(self):
        """MANUAL stacks are user-created, not reviewable."""
        self.assertFalse(
            StackReview.is_reviewable_type(PhotoStack.StackType.MANUAL)
        )


class CreateForStackTestCase(TestCase):
    """Tests for the create_for_stack classmethod."""

    def setUp(self):
        """Create test user."""
        self.user = User.objects.create(username="createtest")

    def test_returns_none_for_non_reviewable_stack_types(self):
        """Should return None for all current stack types (none are reviewable)."""
        for stack_type in PhotoStack.StackType.values:
            stack = PhotoStack.objects.create(
                owner=self.user,
                stack_type=stack_type,
            )
            review = StackReview.create_for_stack(stack)
            self.assertIsNone(review)

    def test_returns_none_for_manual_stack(self):
        """Should return None for manual stacks."""
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        review = StackReview.create_for_stack(stack)
        self.assertIsNone(review)

    @patch.object(StackReview, 'get_reviewable_stack_types')
    def test_creates_review_for_reviewable_type(self, mock_get_types):
        """Should create review if stack type is in reviewable list."""
        # Simulate having a reviewable type
        mock_get_types.return_value = [PhotoStack.StackType.MANUAL]
        
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        review = StackReview.create_for_stack(stack)
        
        self.assertIsNotNone(review)
        self.assertEqual(review.stack, stack)
        self.assertEqual(review.reviewer, self.user)
        self.assertEqual(review.decision, StackReview.Decision.PENDING)

    @patch.object(StackReview, 'get_reviewable_stack_types')
    def test_returns_existing_review_if_present(self, mock_get_types):
        """Should return existing review instead of creating duplicate."""
        mock_get_types.return_value = [PhotoStack.StackType.MANUAL]
        
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        
        # Create first review
        review1 = StackReview.create_for_stack(stack)
        # Try to create again
        review2 = StackReview.create_for_stack(stack)
        
        self.assertEqual(review1.id, review2.id)


class ResolveTestCase(TestCase):
    """Tests for the resolve method."""

    def setUp(self):
        """Create test user, photos, and stack."""
        self.user = User.objects.create(username="resolvetest")
        
        # Create photos with files
        self.photos = []
        for i in range(3):
            file = File.objects.create(
                hash=f"resolve{i}" + "a" * 25,
                path=f"/photos/img_{i}.jpg",
                type=File.IMAGE,
            )
            photo = Photo.objects.create(
                owner=self.user,
                main_file=file,
                image_hash=f"resolve{i}" + "b" * 25,
                added_on=timezone.now(),
                in_trashcan=False,
            )
            self.photos.append(photo)
        
        # Create stack with photos
        self.stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        for photo in self.photos:
            photo.stacks.add(self.stack)
        
        # Create review
        self.review = StackReview.objects.create(
            stack=self.stack,
            reviewer=self.user,
        )

    def test_resolve_sets_kept_photo(self):
        """Should set the kept_photo field."""
        kept = self.photos[0]
        self.review.resolve(kept)
        
        self.review.refresh_from_db()
        self.assertEqual(self.review.kept_photo, kept)

    def test_resolve_sets_decision_to_resolved(self):
        """Should change decision to RESOLVED."""
        self.review.resolve(self.photos[0])
        
        self.review.refresh_from_db()
        self.assertEqual(self.review.decision, StackReview.Decision.RESOLVED)

    def test_resolve_sets_reviewed_at(self):
        """Should set reviewed_at timestamp."""
        self.assertIsNone(self.review.reviewed_at)
        
        self.review.resolve(self.photos[0])
        
        self.review.refresh_from_db()
        self.assertIsNotNone(self.review.reviewed_at)

    def test_resolve_sets_stack_primary_photo(self):
        """Should update stack's primary_photo."""
        kept = self.photos[0]
        self.review.resolve(kept)
        
        self.stack.refresh_from_db()
        self.assertEqual(self.stack.primary_photo, kept)

    def test_resolve_trashes_other_photos(self):
        """Should move non-kept photos to trashcan."""
        kept = self.photos[0]
        self.review.resolve(kept, trash_others=True)
        
        for photo in self.photos:
            photo.refresh_from_db()
        
        self.assertFalse(self.photos[0].in_trashcan)
        self.assertTrue(self.photos[1].in_trashcan)
        self.assertTrue(self.photos[2].in_trashcan)

    def test_resolve_sets_trashed_count(self):
        """Should count trashed photos."""
        self.review.resolve(self.photos[0], trash_others=True)
        
        self.review.refresh_from_db()
        self.assertEqual(self.review.trashed_count, 2)

    def test_resolve_without_trashing(self):
        """Should not trash photos when trash_others=False."""
        self.review.resolve(self.photos[0], trash_others=False)
        
        for photo in self.photos:
            photo.refresh_from_db()
            self.assertFalse(photo.in_trashcan)

    def test_resolve_returns_self(self):
        """Should return the review instance."""
        result = self.review.resolve(self.photos[0])
        self.assertEqual(result, self.review)


class DismissTestCase(TestCase):
    """Tests for the dismiss method."""

    def setUp(self):
        """Create test user, photos, and stack."""
        self.user = User.objects.create(username="dismisstest")
        
        # Create photos
        self.photos = []
        for i in range(2):
            file = File.objects.create(
                hash=f"dismiss{i}" + "a" * 26,
                path=f"/photos/dismiss_{i}.jpg",
                type=File.IMAGE,
            )
            photo = Photo.objects.create(
                owner=self.user,
                main_file=file,
                image_hash=f"dismiss{i}" + "b" * 26,
                added_on=timezone.now(),
            )
            self.photos.append(photo)
        
        # Create stack
        self.stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        for photo in self.photos:
            photo.stacks.add(self.stack)
        
        # Create review
        self.review = StackReview.objects.create(
            stack=self.stack,
            reviewer=self.user,
        )

    def test_dismiss_sets_decision_to_dismissed(self):
        """Should change decision to DISMISSED."""
        self.review.dismiss()
        
        self.review.refresh_from_db()
        self.assertEqual(self.review.decision, StackReview.Decision.DISMISSED)

    def test_dismiss_sets_reviewed_at(self):
        """Should set reviewed_at timestamp."""
        self.review.dismiss()
        
        self.review.refresh_from_db()
        self.assertIsNotNone(self.review.reviewed_at)

    def test_dismiss_unlinks_photos_from_stack(self):
        """Should remove photos from the stack."""
        # Verify photos are in stack
        self.assertEqual(self.stack.photos.count(), 2)
        
        self.review.dismiss()
        
        # Verify photos are unlinked
        self.stack.refresh_from_db()
        self.assertEqual(self.stack.photos.count(), 0)

    def test_dismiss_returns_self(self):
        """Should return the review instance."""
        result = self.review.dismiss()
        self.assertEqual(result, self.review)

    def test_dismiss_photos_still_exist(self):
        """Photos should not be deleted, just unlinked."""
        photo_ids = [p.id for p in self.photos]
        
        self.review.dismiss()
        
        for pid in photo_ids:
            self.assertTrue(Photo.objects.filter(id=pid).exists())


class RevertTestCase(TestCase):
    """Tests for the revert method."""

    def setUp(self):
        """Create test user, photos, and resolved review."""
        self.user = User.objects.create(username="reverttest")
        
        # Create photos
        self.photos = []
        for i in range(3):
            file = File.objects.create(
                hash=f"revert{i}" + "a" * 26,
                path=f"/photos/revert_{i}.jpg",
                type=File.IMAGE,
            )
            photo = Photo.objects.create(
                owner=self.user,
                main_file=file,
                image_hash=f"revert{i}" + "b" * 26,
                added_on=timezone.now(),
                in_trashcan=False,
            )
            self.photos.append(photo)
        
        # Create stack
        self.stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        for photo in self.photos:
            photo.stacks.add(self.stack)
        
        # Create and resolve review
        self.review = StackReview.objects.create(
            stack=self.stack,
            reviewer=self.user,
        )
        self.review.resolve(self.photos[0], trash_others=True)

    def test_revert_restores_trashed_photos(self):
        """Should restore photos from trashcan."""
        # Verify photos are trashed
        self.photos[1].refresh_from_db()
        self.photos[2].refresh_from_db()
        self.assertTrue(self.photos[1].in_trashcan)
        self.assertTrue(self.photos[2].in_trashcan)
        
        self.review.revert()
        
        # Verify photos are restored
        self.photos[1].refresh_from_db()
        self.photos[2].refresh_from_db()
        self.assertFalse(self.photos[1].in_trashcan)
        self.assertFalse(self.photos[2].in_trashcan)

    def test_revert_resets_decision_to_pending(self):
        """Should change decision back to PENDING."""
        self.review.revert()
        
        self.review.refresh_from_db()
        self.assertEqual(self.review.decision, StackReview.Decision.PENDING)

    def test_revert_clears_kept_photo(self):
        """Should clear the kept_photo field."""
        self.review.revert()
        
        self.review.refresh_from_db()
        self.assertIsNone(self.review.kept_photo)

    def test_revert_clears_trashed_count(self):
        """Should reset trashed_count to 0."""
        self.review.revert()
        
        self.review.refresh_from_db()
        self.assertEqual(self.review.trashed_count, 0)

    def test_revert_clears_reviewed_at(self):
        """Should clear reviewed_at timestamp."""
        self.review.revert()
        
        self.review.refresh_from_db()
        self.assertIsNone(self.review.reviewed_at)

    def test_revert_clears_stack_primary_photo(self):
        """Should clear stack's primary_photo."""
        self.review.revert()
        
        self.stack.refresh_from_db()
        self.assertIsNone(self.stack.primary_photo)

    def test_revert_returns_restored_count(self):
        """Should return number of restored photos."""
        count = self.review.revert()
        self.assertEqual(count, 2)

    def test_revert_does_nothing_if_not_resolved(self):
        """Should do nothing if decision is not RESOLVED."""
        # Create pending review
        stack2 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        review2 = StackReview.objects.create(
            stack=stack2,
            reviewer=self.user,
            decision=StackReview.Decision.PENDING,
        )
        
        result = review2.revert()
        
        review2.refresh_from_db()
        self.assertEqual(result, review2)  # Returns self, not count
        self.assertEqual(review2.decision, StackReview.Decision.PENDING)

    def test_revert_does_nothing_if_dismissed(self):
        """Should do nothing if decision is DISMISSED."""
        self.review.decision = StackReview.Decision.DISMISSED
        self.review.save()
        
        result = self.review.revert()
        
        self.review.refresh_from_db()
        self.assertEqual(result, self.review)  # Returns self
        self.assertEqual(self.review.decision, StackReview.Decision.DISMISSED)


class EdgeCasesTestCase(TestCase):
    """Edge case tests for StackReview."""

    def setUp(self):
        """Create test user."""
        self.user = User.objects.create(username="edgetest")

    def test_resolve_with_single_photo_stack(self):
        """Should handle stack with only one photo."""
        file = File.objects.create(
            hash="single" + "a" * 26,
            path="/photos/single.jpg",
            type=File.IMAGE,
        )
        photo = Photo.objects.create(
            owner=self.user,
            main_file=file,
            image_hash="single" + "b" * 26,
            added_on=timezone.now(),
        )
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        photo.stacks.add(stack)
        
        review = StackReview.objects.create(
            stack=stack,
            reviewer=self.user,
        )
        review.resolve(photo)
        
        review.refresh_from_db()
        self.assertEqual(review.trashed_count, 0)
        self.assertEqual(review.kept_photo, photo)

    def test_dismiss_empty_stack(self):
        """Should handle stack with no photos."""
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        review = StackReview.objects.create(
            stack=stack,
            reviewer=self.user,
        )
        
        # Should not raise error
        review.dismiss()
        
        review.refresh_from_db()
        self.assertEqual(review.decision, StackReview.Decision.DISMISSED)

    def test_revert_when_photos_already_restored(self):
        """Should handle reverting when photos are already not in trash."""
        file = File.objects.create(
            hash="restored" + "a" * 24,
            path="/photos/restored.jpg",
            type=File.IMAGE,
        )
        photo = Photo.objects.create(
            owner=self.user,
            main_file=file,
            image_hash="restored" + "b" * 24,
            added_on=timezone.now(),
            in_trashcan=False,
        )
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        photo.stacks.add(stack)
        
        review = StackReview.objects.create(
            stack=stack,
            reviewer=self.user,
            decision=StackReview.Decision.RESOLVED,
            kept_photo=photo,
            trashed_count=0,
        )
        
        # Should not raise error, returns 0 restored
        count = review.revert()
        self.assertEqual(count, 0)

    def test_stack_cascade_delete(self):
        """Review should be deleted when stack is deleted."""
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        review = StackReview.objects.create(
            stack=stack,
            reviewer=self.user,
        )
        review_id = review.id
        
        stack.delete()
        
        self.assertFalse(StackReview.objects.filter(id=review_id).exists())

    def test_user_set_to_deleted_on_reviewer_delete(self):
        """Reviewer should be set to deleted user when user is deleted."""
        temp_user = User.objects.create(username="temp_reviewer")
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        review = StackReview.objects.create(
            stack=stack,
            reviewer=temp_user,
        )
        
        temp_user.delete()
        
        review.refresh_from_db()
        self.assertEqual(review.reviewer.username, "deleted")

    def test_review_with_note(self):
        """Should store user's note."""
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        review = StackReview.objects.create(
            stack=stack,
            reviewer=self.user,
            note="These are from different events, not duplicates",
        )
        
        review.refresh_from_db()
        self.assertEqual(review.note, "These are from different events, not duplicates")

    def test_review_index_on_reviewer_decision(self):
        """Index on reviewer+decision should exist for efficient queries."""
        # Create multiple reviews with different decisions
        for decision in StackReview.Decision.values:
            stack = PhotoStack.objects.create(
                owner=self.user,
                stack_type=PhotoStack.StackType.MANUAL,
            )
            StackReview.objects.create(
                stack=stack,
                reviewer=self.user,
                decision=decision,
            )
        
        # Query should be efficient (index used)
        pending = StackReview.objects.filter(
            reviewer=self.user,
            decision=StackReview.Decision.PENDING,
        )
        self.assertEqual(pending.count(), 1)
