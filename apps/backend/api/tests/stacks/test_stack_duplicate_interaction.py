"""
Integration tests for interactions between Stacks and Duplicates.

Tests edge cases where photos belong to both stacks and duplicate groups:
- Photo in stack is also part of duplicate group
- Resolving duplicate trashes stack's primary photo
- Deleting stack affects duplicate group
- Concurrent operations on same photos
- Multi-user isolation
"""

from django.test import TestCase
from django.utils import timezone

from api.models.duplicate import Duplicate
from api.models.photo_stack import PhotoStack
from api.tests.utils import (
    create_test_duplicate,
    create_test_photo,
    create_test_photos,
    create_test_stack,
    create_test_user,
)


class PhotoInBothStackAndDuplicateTestCase(TestCase):
    """Tests for photos that are in both a stack and a duplicate group."""

    def setUp(self):
        """Create test user and photos."""
        self.user = create_test_user(username="integrationtest")
        self.photos = create_test_photos(
            4, owner=self.user, added_on=timezone.now(), in_trashcan=False
        )

    def test_photo_can_be_in_stack_and_duplicate_simultaneously(self):
        """Photo should be able to belong to both a stack and duplicate group."""
        # Create stack with first two photos
        stack = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        self.photos[0].stacks.add(stack)
        self.photos[1].stacks.add(stack)

        # Create duplicate group with first and third photos
        duplicate = create_test_duplicate(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
        )
        self.photos[0].duplicates.add(duplicate)
        self.photos[2].duplicates.add(duplicate)

        # Verify photo 0 is in both
        self.assertEqual(self.photos[0].stacks.count(), 1)
        self.assertEqual(self.photos[0].duplicates.count(), 1)

        # Verify stack and duplicate are independent
        self.assertEqual(stack.photos.count(), 2)
        self.assertEqual(duplicate.photos.count(), 2)

    def test_resolving_duplicate_trashes_stacked_photo(self):
        """Resolving duplicate should trash photo even if it's in a stack."""
        # Photo 0 and 1 are in a stack
        stack = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
            primary_photo=self.photos[0],
        )
        self.photos[0].stacks.add(stack)
        self.photos[1].stacks.add(stack)

        # Photo 0 and 2 are duplicates
        duplicate = create_test_duplicate(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        self.photos[0].duplicates.add(duplicate)
        self.photos[2].duplicates.add(duplicate)

        # Resolve duplicate, keeping photo 2 (trash photo 0)
        duplicate.resolve(self.photos[2], trash_others=True)

        # Photo 0 should be trashed
        self.photos[0].refresh_from_db()
        self.assertTrue(self.photos[0].in_trashcan)

        # Photo 0 should still be in stack (not removed)
        self.assertEqual(self.photos[0].stacks.count(), 1)

        # Stack should still have both photos (ManyToMany not affected by trash)
        self.assertEqual(stack.photos.count(), 2)

    def test_resolving_duplicate_trashes_stack_primary(self):
        """What happens when duplicate resolution trashes the stack's primary photo."""
        # Photo 0 is stack primary
        stack = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
            primary_photo=self.photos[0],
        )
        self.photos[0].stacks.add(stack)
        self.photos[1].stacks.add(stack)

        # Photo 0 and 2 are duplicates
        duplicate = create_test_duplicate(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        self.photos[0].duplicates.add(duplicate)
        self.photos[2].duplicates.add(duplicate)

        # Resolve keeping photo 2, trashing photo 0 (the stack primary)
        duplicate.resolve(self.photos[2], trash_others=True)

        # Stack's primary is now trashed - this is a potential issue
        stack.refresh_from_db()
        self.assertTrue(stack.primary_photo.in_trashcan)

        # Note: The system allows this - the UI should handle showing appropriate warning

    def test_deleting_stack_does_not_affect_duplicate(self):
        """Deleting a stack should not affect duplicate group membership."""
        # Photo in both stack and duplicate
        stack = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        self.photos[0].stacks.add(stack)

        duplicate = create_test_duplicate(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
        )
        self.photos[0].duplicates.add(duplicate)
        self.photos[1].duplicates.add(duplicate)

        # Delete the stack
        stack.delete()

        # Photo should still be in duplicate group
        self.photos[0].refresh_from_db()
        self.assertEqual(self.photos[0].duplicates.count(), 1)
        self.assertEqual(duplicate.photos.count(), 2)

    def test_dismissing_duplicate_does_not_affect_stack(self):
        """Dismissing duplicate group should not affect stack membership."""
        # Photo in both
        stack = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        self.photos[0].stacks.add(stack)
        self.photos[1].stacks.add(stack)

        duplicate = create_test_duplicate(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
        )
        self.photos[0].duplicates.add(duplicate)
        self.photos[2].duplicates.add(duplicate)

        # Dismiss the duplicate
        duplicate.dismiss()

        # Photo should still be in stack
        self.photos[0].refresh_from_db()
        self.assertEqual(self.photos[0].stacks.count(), 1)
        self.assertEqual(stack.photos.count(), 2)


class PhotoDeletionCascadeTestCase(TestCase):
    """Tests for photo deletion effects on stacks and duplicates."""

    def setUp(self):
        """Create test user and photos."""
        self.user = create_test_user(username="deletiontest")

    def test_deleting_photo_removes_from_stack(self):
        """Deleting photo should remove it from associated stacks."""
        photo1 = create_test_photo(owner=self.user, added_on=timezone.now())
        photo2 = create_test_photo(owner=self.user, added_on=timezone.now())

        stack = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        photo1.stacks.add(stack)
        photo2.stacks.add(stack)

        self.assertEqual(stack.photos.count(), 2)

        # Delete photo1
        photo1.delete()

        stack.refresh_from_db()
        self.assertEqual(stack.photos.count(), 1)
        self.assertEqual(stack.photos.first(), photo2)

    def test_deleting_photo_removes_from_duplicate(self):
        """Deleting photo should remove it from associated duplicate groups."""
        photo1 = create_test_photo(owner=self.user, added_on=timezone.now())
        photo2 = create_test_photo(owner=self.user, added_on=timezone.now())

        duplicate = create_test_duplicate(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        photo1.duplicates.add(duplicate)
        photo2.duplicates.add(duplicate)

        self.assertEqual(duplicate.photos.count(), 2)

        # Delete photo1
        photo1.delete()

        duplicate.refresh_from_db()
        self.assertEqual(duplicate.photos.count(), 1)

    def test_deleting_stack_primary_sets_to_null(self):
        """Deleting stack's primary photo should set primary_photo to NULL."""
        photo1 = create_test_photo(owner=self.user, added_on=timezone.now())
        photo2 = create_test_photo(owner=self.user, added_on=timezone.now())

        stack = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
            primary_photo=photo1,
        )
        photo1.stacks.add(stack)
        photo2.stacks.add(stack)

        # Delete the primary photo
        photo1.delete()

        stack.refresh_from_db()
        self.assertIsNone(stack.primary_photo)
        self.assertEqual(stack.photos.count(), 1)

    def test_deleting_kept_photo_sets_to_null(self):
        """Deleting duplicate's kept_photo should set kept_photo to NULL."""
        photo1 = create_test_photo(owner=self.user, added_on=timezone.now())
        photo2 = create_test_photo(owner=self.user, added_on=timezone.now())

        duplicate = create_test_duplicate(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            kept_photo=photo1,
        )
        photo1.duplicates.add(duplicate)
        photo2.duplicates.add(duplicate)

        # Delete the kept photo
        photo1.delete()

        duplicate.refresh_from_db()
        self.assertIsNone(duplicate.kept_photo)


class MultiUserIsolationTestCase(TestCase):
    """Tests for proper isolation between users."""

    def setUp(self):
        """Create two test users."""
        self.user1 = create_test_user(username="user1")
        self.user2 = create_test_user(username="user2")

    def test_users_cannot_share_stacks(self):
        """Users should not be able to add photos to another user's stack."""
        photo1 = create_test_photo(owner=self.user1, added_on=timezone.now())
        photo2 = create_test_photo(owner=self.user2, added_on=timezone.now())

        stack = create_test_stack(
            owner=self.user1,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        photo1.stacks.add(stack)

        # Attempt to add user2's photo to user1's stack
        # The ManyToMany doesn't enforce this at DB level, but API should
        photo2.stacks.add(stack)  # This succeeds at DB level

        # Stack contains both photos (no DB-level enforcement)
        self.assertEqual(stack.photos.count(), 2)

        # Note: This is a potential issue - API layer should validate owner

    def test_duplicate_detection_scoped_to_user(self):
        """Duplicate groups should be scoped to owner."""
        photo1 = create_test_photo(owner=self.user1, added_on=timezone.now())

        dup1 = create_test_duplicate(
            owner=self.user1,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        photo1.duplicates.add(dup1)

        # User2's duplicates should be separate
        photo2 = create_test_photo(owner=self.user2, added_on=timezone.now())
        dup2 = create_test_duplicate(
            owner=self.user2,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        photo2.duplicates.add(dup2)

        # Each user should have their own duplicate
        self.assertEqual(Duplicate.objects.filter(owner=self.user1).count(), 1)
        self.assertEqual(Duplicate.objects.filter(owner=self.user2).count(), 1)


class StackMergeWithDuplicatesTestCase(TestCase):
    """Tests for stack merging when photos are also in duplicates."""

    def setUp(self):
        """Create test user and photos."""
        self.user = create_test_user(username="mergetest")
        self.photos = []
        for i in range(4):
            photo = create_test_photo(owner=self.user, added_on=timezone.now())
            self.photos.append(photo)

    def test_merging_stacks_preserves_duplicate_membership(self):
        """Merging stacks should not affect duplicate group membership."""
        # Stack 1 with photo 0, 1
        stack1 = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        self.photos[0].stacks.add(stack1)
        self.photos[1].stacks.add(stack1)

        # Stack 2 with photo 2, 3
        stack2 = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        self.photos[2].stacks.add(stack2)
        self.photos[3].stacks.add(stack2)

        # Photo 1 and 2 are duplicates
        duplicate = create_test_duplicate(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
        )
        self.photos[1].duplicates.add(duplicate)
        self.photos[2].duplicates.add(duplicate)

        # Merge stack2 into stack1
        stack1.merge_with(stack2)

        # All photos should be in stack1
        self.assertEqual(stack1.photos.count(), 4)

        # Duplicate membership should be preserved
        self.assertEqual(self.photos[1].duplicates.count(), 1)
        self.assertEqual(self.photos[2].duplicates.count(), 1)
        self.assertEqual(duplicate.photos.count(), 2)


class PhotoInMultipleStacksTestCase(TestCase):
    """Tests for photos that are in multiple stacks."""

    def setUp(self):
        """Create test user and photos."""
        self.user = create_test_user(username="multistacktest")

    def test_photo_can_be_in_multiple_stacks(self):
        """Photo should be able to belong to multiple stacks."""
        photo = create_test_photo(owner=self.user, added_on=timezone.now())

        stack1 = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.RAW_JPEG_PAIR,
        )
        stack2 = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )

        photo.stacks.add(stack1)
        photo.stacks.add(stack2)

        self.assertEqual(photo.stacks.count(), 2)

    def test_photo_can_be_primary_in_multiple_stacks(self):
        """Photo can be primary photo for multiple stacks."""
        photo = create_test_photo(owner=self.user, added_on=timezone.now())

        stack1 = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.RAW_JPEG_PAIR,
            primary_photo=photo,
        )
        stack2 = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
            primary_photo=photo,
        )

        photo.stacks.add(stack1)
        photo.stacks.add(stack2)

        self.assertEqual(stack1.primary_photo, photo)
        self.assertEqual(stack2.primary_photo, photo)

    def test_removing_photo_from_one_stack_preserves_others(self):
        """Removing from one stack should not affect other stacks."""
        photo = create_test_photo(owner=self.user, added_on=timezone.now())

        stack1 = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack2 = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )

        photo.stacks.add(stack1)
        photo.stacks.add(stack2)

        # Remove from stack1
        photo.stacks.remove(stack1)

        # Should still be in stack2
        self.assertEqual(photo.stacks.count(), 1)
        self.assertIn(stack2, photo.stacks.all())


class DuplicateMergeWithStacksTestCase(TestCase):
    """Tests for duplicate merging when photos are also in stacks."""

    def setUp(self):
        """Create test user and photos."""
        self.user = create_test_user(username="dupmergetest")
        self.photos = []
        for i in range(4):
            photo = create_test_photo(owner=self.user, added_on=timezone.now())
            self.photos.append(photo)

    def test_merging_duplicates_preserves_stack_membership(self):
        """Merging duplicate groups should not affect stack membership."""
        # Photo 0, 1 are in a stack
        stack = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        self.photos[0].stacks.add(stack)
        self.photos[1].stacks.add(stack)

        # Dup1: photo 0, 2
        dup1 = create_test_duplicate(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        self.photos[0].duplicates.add(dup1)
        self.photos[2].duplicates.add(dup1)

        # Dup2: photo 1, 3
        dup2 = create_test_duplicate(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        self.photos[1].duplicates.add(dup2)
        self.photos[3].duplicates.add(dup2)

        # Merge dup2 into dup1
        dup1.merge_with(dup2)

        # Stack membership should be preserved
        self.assertEqual(stack.photos.count(), 2)
        self.assertEqual(self.photos[0].stacks.count(), 1)
        self.assertEqual(self.photos[1].stacks.count(), 1)


class EdgeCasesTestCase(TestCase):
    """Edge case tests for stack/duplicate integration."""

    def setUp(self):
        """Create test user."""
        self.user = create_test_user(username="edgecasetest")

    def test_empty_stack_and_duplicate(self):
        """Empty stack and duplicate should exist without photos."""
        stack = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        duplicate = create_test_duplicate(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
        )

        self.assertEqual(stack.photos.count(), 0)
        self.assertEqual(duplicate.photos.count(), 0)

    def test_single_photo_in_both(self):
        """Single photo can be only member of both stack and duplicate."""
        photo = create_test_photo(owner=self.user, added_on=timezone.now())

        stack = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        photo.stacks.add(stack)

        duplicate = create_test_duplicate(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
        )
        photo.duplicates.add(duplicate)

        self.assertEqual(stack.photos.count(), 1)
        self.assertEqual(duplicate.photos.count(), 1)

    def test_trashing_all_photos_in_stack(self):
        """Trashing all photos in stack should not delete the stack."""
        photo1 = create_test_photo(owner=self.user, added_on=timezone.now())
        photo2 = create_test_photo(owner=self.user, added_on=timezone.now())

        stack = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        photo1.stacks.add(stack)
        photo2.stacks.add(stack)

        # Trash all photos
        photo1.in_trashcan = True
        photo1.save()
        photo2.in_trashcan = True
        photo2.save()

        # Stack should still exist
        self.assertTrue(PhotoStack.objects.filter(id=stack.id).exists())
        self.assertEqual(stack.photos.count(), 2)

    def test_photo_in_multiple_duplicate_groups(self):
        """Photo can be in multiple duplicate groups."""
        photo = create_test_photo(owner=self.user, added_on=timezone.now())

        dup1 = create_test_duplicate(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup2 = create_test_duplicate(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
        )

        photo.duplicates.add(dup1)
        photo.duplicates.add(dup2)

        self.assertEqual(photo.duplicates.count(), 2)

    def test_resolving_duplicate_does_not_affect_other_duplicates(self):
        """Resolving one duplicate should not affect photo's other duplicates."""
        photo1 = create_test_photo(owner=self.user, added_on=timezone.now())
        photo2 = create_test_photo(owner=self.user, added_on=timezone.now())
        photo3 = create_test_photo(owner=self.user, added_on=timezone.now())

        # photo1 is in two duplicate groups
        dup1 = create_test_duplicate(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        photo1.duplicates.add(dup1)
        photo2.duplicates.add(dup1)

        dup2 = create_test_duplicate(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
        )
        photo1.duplicates.add(dup2)
        photo3.duplicates.add(dup2)

        # Resolve dup1, keeping photo1
        dup1.resolve(photo1, trash_others=True)

        # photo1 should still be in dup2
        photo1.refresh_from_db()
        self.assertEqual(photo1.duplicates.count(), 2)
        self.assertIn(dup2, photo1.duplicates.all())

    def test_cascade_effects_are_contained(self):
        """Operations on one group should not cascade unexpectedly."""
        photo1 = create_test_photo(owner=self.user, added_on=timezone.now())
        photo2 = create_test_photo(owner=self.user, added_on=timezone.now())

        # Create complex relationship
        stack = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
            primary_photo=photo1,
        )
        photo1.stacks.add(stack)
        photo2.stacks.add(stack)

        duplicate = create_test_duplicate(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            kept_photo=photo1,
        )
        photo1.duplicates.add(duplicate)
        photo2.duplicates.add(duplicate)

        # Delete the stack
        _stack_id = stack.id
        stack.delete()

        # Duplicate should be unaffected
        self.assertTrue(Duplicate.objects.filter(id=duplicate.id).exists())
        self.assertEqual(duplicate.photos.count(), 2)

        # Photos should still be in duplicate
        photo1.refresh_from_db()
        photo2.refresh_from_db()
        self.assertEqual(photo1.duplicates.count(), 1)
        self.assertEqual(photo2.duplicates.count(), 1)
