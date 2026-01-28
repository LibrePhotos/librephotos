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


class SharedFileTestCase(TestCase):
    """Tests for photos sharing the same File."""

    def setUp(self):
        self.user = create_test_user()

    def test_delete_photo_preserves_shared_file(self):
        """Test that deleting a photo does not delete a file shared with another photo."""
        # Create a shared file
        shared_file = File.objects.create(
            hash="shared_file_hash" + "a" * 17,
            path="/photos/shared_image.jpg",
            type=File.IMAGE,
        )
        
        # Create two photos that share the same file
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        photo1.files.add(shared_file)
        photo1.main_file = shared_file
        photo1.save()
        
        photo2.files.add(shared_file)
        photo2.main_file = shared_file
        photo2.save()
        
        # Verify both photos reference the same file
        self.assertEqual(photo1.main_file.hash, photo2.main_file.hash)
        self.assertEqual(shared_file.photo_set.count(), 2)
        
        # Delete photo1
        photo1.in_trashcan = True
        photo1.save()
        photo1.manual_delete()
        
        # File should still exist (used by photo2)
        self.assertTrue(File.objects.filter(hash=shared_file.hash).exists(),
            "File should not be deleted when another photo still uses it")
        
        # photo2 should still have its main_file
        photo2.refresh_from_db()
        self.assertIsNotNone(photo2.main_file)
        self.assertEqual(photo2.main_file.hash, shared_file.hash)
        
        # photo2's files should still include the shared file
        self.assertTrue(photo2.files.filter(hash=shared_file.hash).exists())

    def test_delete_photo_removes_unshared_file(self):
        """Test that deleting a photo removes a file only used by that photo."""
        import tempfile
        import os
        
        # Create a temp file to simulate a real file
        with tempfile.NamedTemporaryFile(delete=False, suffix='.jpg') as tmp:
            tmp.write(b'test image data')
            temp_path = tmp.name
        
        try:
            # Create a file that's only used by one photo
            unique_file = File.objects.create(
                hash="unique_file_hash" + "a" * 18,
                path=temp_path,
                type=File.IMAGE,
            )
            
            photo = create_test_photo(owner=self.user)
            photo.files.add(unique_file)
            photo.main_file = unique_file
            photo.save()
            
            # Verify only one photo uses this file
            self.assertEqual(unique_file.photo_set.count(), 1)
            
            # Delete the photo
            photo.in_trashcan = True
            photo.save()
            photo.manual_delete()
            
            # File should be deleted from database
            self.assertFalse(File.objects.filter(hash=unique_file.hash).exists(),
                "File should be deleted when no other photos use it")
            
            # Physical file should be deleted
            self.assertFalse(os.path.exists(temp_path),
                "Physical file should be removed from disk")
        finally:
            # Cleanup in case test fails
            if os.path.exists(temp_path):
                os.remove(temp_path)

    def test_delete_photo_with_shared_main_file_different_from_files(self):
        """Test deleting when main_file is shared but files M2M has unique files."""
        # Shared main_file
        shared_main = File.objects.create(
            hash="shared_main_hash" + "a" * 18,
            path="/photos/main.jpg",
            type=File.IMAGE,
        )
        
        # Unique sidecar file for photo1 only
        unique_sidecar = File.objects.create(
            hash="unique_sidecar_hash" + "a" * 15,
            path="/photos/sidecar.xmp",
            type=File.METADATA_FILE,
        )
        
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        # Both photos share main_file
        photo1.main_file = shared_main
        photo1.files.add(shared_main, unique_sidecar)
        photo1.save()
        
        photo2.main_file = shared_main
        photo2.files.add(shared_main)
        photo2.save()
        
        # Delete photo1
        photo1.in_trashcan = True
        photo1.save()
        photo1.manual_delete()
        
        # shared_main should still exist (used by photo2)
        self.assertTrue(File.objects.filter(hash=shared_main.hash).exists())
        
        # unique_sidecar should be deleted (only used by photo1)
        self.assertFalse(File.objects.filter(hash=unique_sidecar.hash).exists())
        
        # photo2 should still reference shared_main
        photo2.refresh_from_db()
        self.assertEqual(photo2.main_file.hash, shared_main.hash)

    def test_delete_last_photo_using_shared_file(self):
        """Test that file is deleted when the last photo using it is deleted."""
        shared_file = File.objects.create(
            hash="eventually_orphan" + "a" * 17,
            path="/photos/shared.jpg",
            type=File.IMAGE,
        )
        
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        
        photo1.files.add(shared_file)
        photo1.main_file = shared_file
        photo1.save()
        
        photo2.files.add(shared_file)
        photo2.main_file = shared_file
        photo2.save()
        
        # Delete photo1 - file should remain
        photo1.in_trashcan = True
        photo1.save()
        photo1.manual_delete()
        
        self.assertTrue(File.objects.filter(hash=shared_file.hash).exists())
        
        # Delete photo2 - file should now be deleted (no photos using it)
        photo2.in_trashcan = True
        photo2.save()
        photo2.manual_delete()
        
        # File should be deleted from database (no physical file to check)
        self.assertFalse(File.objects.filter(hash=shared_file.hash).exists(),
            "File should be deleted when the last photo using it is deleted")
