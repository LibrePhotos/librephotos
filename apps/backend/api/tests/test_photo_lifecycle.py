"""
Tests for Photo Lifecycle - deletion, trashing, restoration.

Tests verify proper cleanup of:
- Stack memberships (ManyToMany)
- Duplicate group memberships (ManyToMany)
- Empty groups after photo removal
- Restoration behavior
"""

import uuid
from django.test import TestCase

from api.models import Photo
from api.models.file import File
from api.models.photo_stack import PhotoStack
from api.models.duplicate import Duplicate
from api.tests.utils import create_test_photo, create_test_user


class PhotoDeletionStackCleanupTestCase(TestCase):
    """Tests for photo deletion and stack cleanup."""

    def setUp(self):
        self.user = create_test_user()

    def test_manual_delete_clears_stack_membership(self):
        """Test that manual_delete removes photo from stacks."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo3 = create_test_photo(owner=self.user)
        
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        stack.photos.add(photo1, photo2, photo3)
        
        self.assertEqual(stack.photos.count(), 3)
        
        # Delete photo1
        photo1.in_trashcan = True
        photo1.save()
        photo1.manual_delete()
        
        # photo1 should be removed from stack
        photo1.refresh_from_db()
        self.assertEqual(photo1.stacks.count(), 0)
        
        # Stack should still have 2 photos
        stack.refresh_from_db()
        self.assertEqual(stack.photos.count(), 2)

    def test_manual_delete_deletes_stack_with_one_remaining(self):
        """Test that deleting a photo leaves stack with only 1 photo, stack is deleted."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        stack.photos.add(photo1, photo2)
        stack_id = stack.id
        
        # Delete photo1
        photo1.in_trashcan = True
        photo1.save()
        photo1.manual_delete()
        
        # Stack should be deleted (only 1 photo remaining)
        self.assertFalse(PhotoStack.objects.filter(id=stack_id).exists())
        
        # photo2 should have no stacks
        photo2.refresh_from_db()
        self.assertEqual(photo2.stacks.count(), 0)

    def test_manual_delete_deletes_empty_stack(self):
        """Test that deleting all photos in stack deletes the stack."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        stack.photos.add(photo1, photo2)
        stack_id = stack.id
        
        # Delete both photos
        photo1.in_trashcan = True
        photo1.save()
        photo1.manual_delete()
        
        photo2.in_trashcan = True
        photo2.save()
        photo2.manual_delete()
        
        # Stack should be deleted
        self.assertFalse(PhotoStack.objects.filter(id=stack_id).exists())


class PhotoDeletionDuplicateCleanupTestCase(TestCase):
    """Tests for photo deletion and duplicate group cleanup."""

    def setUp(self):
        self.user = create_test_user()

    def test_manual_delete_clears_duplicate_membership(self):
        """Test that manual_delete removes photo from duplicate groups.
        
        BUG #12: This test will FAIL if duplicates are not cleared!
        """
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo3 = create_test_photo(owner=self.user)
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        duplicate.photos.add(photo1, photo2, photo3)
        
        self.assertEqual(duplicate.photos.count(), 3)
        
        # Delete photo1
        photo1.in_trashcan = True
        photo1.save()
        photo1.manual_delete()
        
        # photo1 should be removed from duplicate group
        photo1.refresh_from_db()
        self.assertEqual(photo1.duplicates.count(), 0,
            "Bug #12: manual_delete should clear duplicates")
        
        # Duplicate group should still have 2 photos
        duplicate.refresh_from_db()
        self.assertEqual(duplicate.photos.count(), 2)

    def test_manual_delete_deletes_duplicate_with_one_remaining(self):
        """Test that deleting a photo leaves duplicate with only 1 photo, group is deleted.
        
        BUG #12: This test will FAIL if duplicate groups are not cleaned up!
        """
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        duplicate.photos.add(photo1, photo2)
        duplicate_id = duplicate.id
        
        # Delete photo1
        photo1.in_trashcan = True
        photo1.save()
        photo1.manual_delete()
        
        # Duplicate group should be deleted (only 1 photo remaining)
        self.assertFalse(Duplicate.objects.filter(id=duplicate_id).exists(),
            "Bug #12: Duplicate group with 1 photo should be deleted")
        
        # photo2 should have no duplicate groups
        photo2.refresh_from_db()
        self.assertEqual(photo2.duplicates.count(), 0)

    def test_manual_delete_deletes_empty_duplicate_group(self):
        """Test that deleting all photos in duplicate group deletes the group."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        duplicate.photos.add(photo1, photo2)
        duplicate_id = duplicate.id
        
        # Delete both photos
        photo1.in_trashcan = True
        photo1.save()
        photo1.manual_delete()
        
        photo2.in_trashcan = True
        photo2.save()
        photo2.manual_delete()
        
        # Duplicate group should be deleted
        self.assertFalse(Duplicate.objects.filter(id=duplicate_id).exists(),
            "Bug #12: Empty duplicate group should be deleted")


class PhotoTrashRestoreTestCase(TestCase):
    """Tests for trashing and restoring photos."""

    def setUp(self):
        self.user = create_test_user()

    def test_trashed_photo_preserves_stack_membership(self):
        """Test that trashing a photo does NOT remove it from stacks."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        stack.photos.add(photo1, photo2)
        
        # Trash photo1 (not permanent delete)
        photo1.in_trashcan = True
        photo1.save()
        
        # photo1 should still be in stack (just trashed)
        photo1.refresh_from_db()
        self.assertEqual(photo1.stacks.count(), 1)
        
        stack.refresh_from_db()
        self.assertEqual(stack.photos.count(), 2)

    def test_trashed_photo_preserves_duplicate_membership(self):
        """Test that trashing a photo does NOT remove it from duplicates."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        duplicate.photos.add(photo1, photo2)
        
        # Trash photo1 (not permanent delete)
        photo1.in_trashcan = True
        photo1.save()
        
        # photo1 should still be in duplicate group (just trashed)
        photo1.refresh_from_db()
        self.assertEqual(photo1.duplicates.count(), 1)
        
        duplicate.refresh_from_db()
        self.assertEqual(duplicate.photos.count(), 2)

    def test_restore_photo_from_trash(self):
        """Test that restoring a photo from trash works correctly."""
        photo1 = create_test_photo(owner=self.user, in_trashcan=True)
        
        # Restore
        photo1.in_trashcan = False
        photo1.save()
        
        photo1.refresh_from_db()
        self.assertFalse(photo1.in_trashcan)


class PhotoInMultipleGroupsTestCase(TestCase):
    """Tests for photos that are in multiple stacks and/or duplicate groups."""

    def setUp(self):
        self.user = create_test_user()

    def test_photo_in_both_stack_and_duplicate(self):
        """Test deleting photo that's in both a stack and duplicate group."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo3 = create_test_photo(owner=self.user)
        
        # Photo1 is in a burst stack with photo2
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        stack.photos.add(photo1, photo2)
        
        # Photo1 is also in a duplicate group with photo3
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        duplicate.photos.add(photo1, photo3)
        
        stack_id = stack.id
        duplicate_id = duplicate.id
        
        # Delete photo1
        photo1.in_trashcan = True
        photo1.save()
        photo1.manual_delete()
        
        photo1.refresh_from_db()
        
        # Both relationships should be cleared
        self.assertEqual(photo1.stacks.count(), 0)
        self.assertEqual(photo1.duplicates.count(), 0,
            "Bug #12: Duplicates should be cleared on delete")
        
        # Both groups should be deleted (only 1 photo remaining in each)
        self.assertFalse(PhotoStack.objects.filter(id=stack_id).exists())
        self.assertFalse(Duplicate.objects.filter(id=duplicate_id).exists(),
            "Bug #12: Duplicate group should be deleted")

    def test_photo_in_multiple_stacks(self):
        """Test photo that's in multiple stacks (different types)."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo3 = create_test_photo(owner=self.user)
        
        # Stack 1: Burst with photo1 and photo2
        stack1 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        stack1.photos.add(photo1, photo2)
        
        # Stack 2: Manual with photo1 and photo3
        stack2 = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack2.photos.add(photo1, photo3)
        
        stack1_id = stack1.id
        stack2_id = stack2.id
        
        # Delete photo1
        photo1.in_trashcan = True
        photo1.save()
        photo1.manual_delete()
        
        # Both stacks should be deleted (only 1 photo remaining in each)
        self.assertFalse(PhotoStack.objects.filter(id=stack1_id).exists())
        self.assertFalse(PhotoStack.objects.filter(id=stack2_id).exists())


class DuplicateResolutionCleanupTestCase(TestCase):
    """Tests for duplicate resolution affecting photo lifecycle."""

    def setUp(self):
        self.user = create_test_user()

    def test_resolve_duplicate_trashes_non_kept_photos(self):
        """Test that resolving a duplicate trashes other photos."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo3 = create_test_photo(owner=self.user)
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        duplicate.photos.add(photo1, photo2, photo3)
        
        # Resolve keeping photo1
        duplicate.resolve(kept_photo=photo1)
        
        # photo2 and photo3 should be trashed
        photo2.refresh_from_db()
        photo3.refresh_from_db()
        self.assertTrue(photo2.in_trashcan)
        self.assertTrue(photo3.in_trashcan)
        
        # photo1 should not be trashed
        photo1.refresh_from_db()
        self.assertFalse(photo1.in_trashcan)

    def test_resolve_duplicate_updates_status(self):
        """Test that resolving updates duplicate status."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.PENDING,
        )
        duplicate.photos.add(photo1, photo2)
        
        duplicate.resolve(kept_photo=photo1)
        
        duplicate.refresh_from_db()
        self.assertEqual(duplicate.review_status, Duplicate.ReviewStatus.RESOLVED)


class EdgeCasesTestCase(TestCase):
    """Edge cases for photo lifecycle."""

    def setUp(self):
        self.user = create_test_user()

    def test_delete_photo_not_in_any_group(self):
        """Test deleting a photo that's not in any stack or duplicate group."""
        photo = create_test_photo(owner=self.user)
        
        photo.in_trashcan = True
        photo.save()
        photo.manual_delete()
        
        photo.refresh_from_db()
        self.assertTrue(photo.removed)

    def test_delete_photo_with_no_main_file(self):
        """Test deleting a photo without a main_file."""
        photo = create_test_photo(owner=self.user)
        photo.main_file = None
        photo.save()
        
        photo.in_trashcan = True
        photo.save()
        
        # Should not crash
        photo.manual_delete()
        
        photo.refresh_from_db()
        self.assertTrue(photo.removed)

    def test_stack_primary_photo_deleted(self):
        """Test what happens when the primary photo of a stack is deleted."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo3 = create_test_photo(owner=self.user)
        
        stack = PhotoStack.objects.create(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
            primary_photo=photo1,
        )
        stack.photos.add(photo1, photo2, photo3)
        
        # Delete the primary photo
        photo1.in_trashcan = True
        photo1.save()
        photo1.manual_delete()
        
        # Stack should still exist with 2 photos
        stack.refresh_from_db()
        self.assertEqual(stack.photos.count(), 2)
        
        # Primary photo reference might be stale - check it
        # (This tests if there's a bug in primary_photo handling)
        # The primary_photo should ideally be updated or cleared

    def test_duplicate_kept_photo_deleted(self):
        """Test what happens when the kept_photo of a resolved duplicate is deleted."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        duplicate = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            review_status=Duplicate.ReviewStatus.RESOLVED,
            kept_photo=photo1,
        )
        duplicate.photos.add(photo1, photo2)
        duplicate_id = duplicate.id
        
        # Now delete the kept photo
        photo1.in_trashcan = True
        photo1.save()
        photo1.manual_delete()
        
        # Duplicate group should be deleted (only 1 photo remaining)
        self.assertFalse(Duplicate.objects.filter(id=duplicate_id).exists(),
            "Duplicate group with 1 photo should be deleted after kept_photo deletion")
