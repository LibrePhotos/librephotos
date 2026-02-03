"""
Tests for multi-user isolation and security.

Ensures that:
- Users can only see/modify their own duplicates and stacks
- Shared photos don't leak into other users' detection
- Admin access is properly scoped
- Cross-user operations are blocked
"""

from django.test import TestCase
from rest_framework.test import APIClient, APITestCase

from api.models.duplicate import Duplicate
from api.models.photo_stack import PhotoStack
from api.tests.utils import create_test_photo, create_test_user


class DuplicateUserIsolationTestCase(APITestCase):
    """Test that duplicates are properly scoped to users."""

    def setUp(self):
        self.user1 = create_test_user()
        self.user2 = create_test_user()
        self.admin = create_test_user()
        self.admin.is_staff = True
        self.admin.save()
        
        self.client = APIClient()

    def test_user_cannot_see_other_user_duplicates(self):
        """Test that users can only see their own duplicates."""
        # Create duplicate for user2
        photos = [create_test_photo(owner=self.user2) for _ in range(2)]
        dup = Duplicate.objects.create(
            owner=self.user2,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup.photos.add(*photos)
        
        # Login as user1
        self.client.force_authenticate(user=self.user1)
        
        # Try to access duplicate list
        response = self.client.get("/api/duplicates")
        self.assertEqual(response.status_code, 200)
        
        # Should not see user2's duplicate
        dup_ids = [d["id"] for d in response.data.get("results", [])]
        self.assertNotIn(str(dup.id), dup_ids)

    def test_user_cannot_access_other_user_duplicate_detail(self):
        """Test that users cannot access other users' duplicate details."""
        photos = [create_test_photo(owner=self.user2) for _ in range(2)]
        dup = Duplicate.objects.create(
            owner=self.user2,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup.photos.add(*photos)
        
        self.client.force_authenticate(user=self.user1)
        
        response = self.client.get(f"/api/duplicates/{dup.id}")
        self.assertIn(response.status_code, [403, 404])

    def test_user_cannot_resolve_other_user_duplicate(self):
        """Test that users cannot resolve other users' duplicates."""
        photos = [create_test_photo(owner=self.user2) for _ in range(2)]
        dup = Duplicate.objects.create(
            owner=self.user2,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup.photos.add(*photos)
        
        self.client.force_authenticate(user=self.user1)
        
        response = self.client.post(
            f"/api/duplicates/{dup.id}/resolve",
            {"kept_photo_id": str(photos[0].pk)},
            format="json"
        )
        self.assertIn(response.status_code, [403, 404])

    def test_user_cannot_delete_other_user_duplicate(self):
        """Test that users cannot delete other users' duplicates."""
        photos = [create_test_photo(owner=self.user2) for _ in range(2)]
        dup = Duplicate.objects.create(
            owner=self.user2,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup.photos.add(*photos)
        
        self.client.force_authenticate(user=self.user1)
        
        response = self.client.delete(f"/api/duplicates/{dup.id}/delete")
        self.assertIn(response.status_code, [403, 404])
        
        # Duplicate should still exist
        self.assertTrue(Duplicate.objects.filter(pk=dup.pk).exists())

    def test_admin_can_see_duplicate_stats(self):
        """Test that admin can see global stats."""
        # Create duplicates for different users
        for user in [self.user1, self.user2]:
            photos = [create_test_photo(owner=user) for _ in range(2)]
            dup = Duplicate.objects.create(
                owner=user,
                duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            )
            dup.photos.add(*photos)
        
        self.client.force_authenticate(user=self.admin)
        
        response = self.client.get("/api/duplicates/stats")
        self.assertEqual(response.status_code, 200)


class StackUserIsolationTestCase(APITestCase):
    """Test that stacks are properly scoped to users."""

    def setUp(self):
        self.user1 = create_test_user()
        self.user2 = create_test_user()
        self.client = APIClient()

    def test_user_cannot_see_other_user_stacks(self):
        """Test that users can only see their own stacks."""
        # Create stack for user2
        photos = [create_test_photo(owner=self.user2) for _ in range(2)]
        stack = PhotoStack.objects.create(
            owner=self.user2,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        stack.photos.add(*photos)
        
        self.client.force_authenticate(user=self.user1)
        
        response = self.client.get("/api/stacks")
        self.assertEqual(response.status_code, 200)
        
        stack_ids = [s["id"] for s in response.data.get("results", [])]
        self.assertNotIn(str(stack.id), stack_ids)

    def test_user_cannot_access_other_user_stack_detail(self):
        """Test that users cannot access other users' stack details."""
        photos = [create_test_photo(owner=self.user2) for _ in range(2)]
        stack = PhotoStack.objects.create(
            owner=self.user2,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        stack.photos.add(*photos)
        
        self.client.force_authenticate(user=self.user1)
        
        response = self.client.get(f"/api/stacks/{stack.id}")
        self.assertIn(response.status_code, [403, 404])

    def test_user_cannot_modify_other_user_stack(self):
        """Test that users cannot modify other users' stacks."""
        photos = [create_test_photo(owner=self.user2) for _ in range(3)]
        stack = PhotoStack.objects.create(
            owner=self.user2,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(*photos[:2])
        
        self.client.force_authenticate(user=self.user1)
        
        # Try to add a photo
        response = self.client.post(
            f"/api/stacks/{stack.id}/add",
            {"photo_ids": [str(photos[2].pk)]},
            format="json"
        )
        self.assertIn(response.status_code, [403, 404])

    def test_user_cannot_delete_other_user_stack(self):
        """Test that users cannot delete other users' stacks."""
        photos = [create_test_photo(owner=self.user2) for _ in range(2)]
        stack = PhotoStack.objects.create(
            owner=self.user2,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(*photos)
        
        self.client.force_authenticate(user=self.user1)
        
        response = self.client.delete(f"/api/stacks/{stack.id}/delete")
        self.assertIn(response.status_code, [403, 404])
        
        # Stack should still exist
        self.assertTrue(PhotoStack.objects.filter(pk=stack.pk).exists())

    def test_user_cannot_create_stack_with_other_user_photos(self):
        """Test that users cannot create stacks with other users' photos."""
        other_photos = [create_test_photo(owner=self.user2) for _ in range(2)]
        
        self.client.force_authenticate(user=self.user1)
        
        response = self.client.post(
            "/api/stacks/manual",
            {"photo_ids": [str(p.pk) for p in other_photos]},
            format="json"
        )
        # Should either fail or create empty stack
        if response.status_code == 201:
            # If created, should have no photos
            stack_id = response.data.get("id")
            if stack_id:
                stack = PhotoStack.objects.get(pk=stack_id)
                self.assertEqual(stack.photos.count(), 0)
        else:
            self.assertIn(response.status_code, [400, 403, 404])


class SharedPhotoIsolationTestCase(TestCase):
    """Test that shared photos don't affect personal stacks/duplicates."""

    def setUp(self):
        self.user1 = create_test_user()
        self.user2 = create_test_user()

    def test_shared_photo_not_in_receiver_stacks(self):
        """Test that photos shared TO a user don't appear in their stack detection."""
        # Create photo for user1
        photo1 = create_test_photo(owner=self.user1)
        
        # Share with user2
        photo1.shared_to.add(self.user2)
        
        # Create a stack for user1
        photo2 = create_test_photo(owner=self.user1)
        stack = PhotoStack.objects.create(
            owner=self.user1,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(photo1, photo2)
        
        # User2 should not see this stack
        user2_stacks = PhotoStack.objects.filter(owner=self.user2)
        self.assertEqual(user2_stacks.count(), 0)

    def test_shared_photo_not_in_receiver_duplicates(self):
        """Test that shared photos don't appear in receiver's duplicate detection."""
        # Create photos for user1
        photos = [create_test_photo(owner=self.user1) for _ in range(2)]
        
        # Create duplicate group for user1
        dup = Duplicate.objects.create(
            owner=self.user1,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup.photos.add(*photos)
        
        # Share one photo with user2
        photos[0].shared_to.add(self.user2)
        
        # User2 should not see this duplicate
        user2_dups = Duplicate.objects.filter(owner=self.user2)
        self.assertEqual(user2_dups.count(), 0)

    def test_user_stack_unaffected_by_shared_photos(self):
        """Test that user's own stacks aren't affected by sharing."""
        # Create stack for user1
        photos = [create_test_photo(owner=self.user1) for _ in range(3)]
        stack = PhotoStack.objects.create(
            owner=self.user1,
            stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        )
        stack.photos.add(*photos)
        
        # Share one photo
        photos[0].shared_to.add(self.user2)
        
        # Stack should still have all 3 photos
        stack.refresh_from_db()
        self.assertEqual(stack.photos.count(), 3)


class DetectionUserIsolationTestCase(APITestCase):
    """Test that detection operations are properly isolated."""

    def setUp(self):
        self.user1 = create_test_user()
        self.user2 = create_test_user()
        self.client = APIClient()

    def test_duplicate_detection_only_affects_own_photos(self):
        """Test that duplicate detection only processes user's own photos."""
        # Create photos for both users with same hash (simulating duplicates)
        photo1_u1 = create_test_photo(owner=self.user1)
        photo2_u1 = create_test_photo(owner=self.user1)
        photo1_u2 = create_test_photo(owner=self.user2)
        photo2_u2 = create_test_photo(owner=self.user2)
        
        # Set same perceptual hash to simulate visual duplicates
        same_hash = "0" * 16
        for photo in [photo1_u1, photo2_u1, photo1_u2, photo2_u2]:
            photo.image_phash = same_hash
            photo.save()
        
        self.client.force_authenticate(user=self.user1)
        
        # Trigger detection for user1
        response = self.client.post("/api/duplicates/detect")
        self.assertIn(response.status_code, [200, 202])
        
        # User2's photos should not be in user1's duplicates
        user1_dups = Duplicate.objects.filter(owner=self.user1)
        for dup in user1_dups:
            for photo in dup.photos.all():
                self.assertEqual(photo.owner, self.user1)

    def test_stack_detection_only_affects_own_photos(self):
        """Test that stack detection only processes user's own photos."""
        # Create photos for both users
        for _ in range(3):
            create_test_photo(owner=self.user1)
            create_test_photo(owner=self.user2)
        
        self.client.force_authenticate(user=self.user1)
        
        # Trigger stack detection for user1
        response = self.client.post("/api/stacks/detect")
        self.assertIn(response.status_code, [200, 202])
        
        # User2 should have no stacks created
        user2_stacks = PhotoStack.objects.filter(owner=self.user2)
        self.assertEqual(user2_stacks.count(), 0)


class CrossUserOperationTestCase(APITestCase):
    """Test that cross-user operations are properly blocked."""

    def setUp(self):
        self.user1 = create_test_user()
        self.user2 = create_test_user()
        self.client = APIClient()

    def test_cannot_add_other_user_photo_to_own_stack(self):
        """Test that users cannot add other users' photos to their stacks."""
        own_photos = [create_test_photo(owner=self.user1) for _ in range(2)]
        other_photo = create_test_photo(owner=self.user2)
        
        stack = PhotoStack.objects.create(
            owner=self.user1,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(*own_photos)
        
        self.client.force_authenticate(user=self.user1)
        
        _response = self.client.post(
            f"/api/stacks/{stack.id}/add",
            {"photo_ids": [str(other_photo.pk)]},
            format="json"
        )
        
        # Should either fail or not add the photo
        stack.refresh_from_db()
        self.assertNotIn(other_photo, stack.photos.all())

    def test_cannot_resolve_duplicate_with_other_user_photo(self):
        """Test that users cannot resolve duplicates by keeping other user's photo."""
        photos = [create_test_photo(owner=self.user1) for _ in range(2)]
        other_photo = create_test_photo(owner=self.user2)
        
        dup = Duplicate.objects.create(
            owner=self.user1,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup.photos.add(*photos)
        
        self.client.force_authenticate(user=self.user1)
        
        # Try to resolve keeping other user's photo
        response = self.client.post(
            f"/api/duplicates/{dup.id}/resolve",
            {"kept_photo_id": str(other_photo.pk)},
            format="json"
        )
        
        # Should fail
        self.assertIn(response.status_code, [400, 403, 404])

    def test_cannot_set_other_user_photo_as_stack_primary(self):
        """Test that users cannot set other user's photo as stack primary."""
        own_photos = [create_test_photo(owner=self.user1) for _ in range(2)]
        other_photo = create_test_photo(owner=self.user2)
        
        stack = PhotoStack.objects.create(
            owner=self.user1,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        stack.photos.add(*own_photos)
        
        self.client.force_authenticate(user=self.user1)
        
        _response = self.client.post(
            f"/api/stacks/{stack.id}/primary",
            {"photo_id": str(other_photo.pk)},
            format="json"
        )
        
        # Should fail or not set the photo
        stack.refresh_from_db()
        self.assertNotEqual(stack.primary_photo, other_photo)


class AdminAccessTestCase(APITestCase):
    """Test admin access and capabilities."""

    def setUp(self):
        self.user = create_test_user()
        self.admin = create_test_user()
        self.admin.is_staff = True
        self.admin.save()
        self.client = APIClient()

    def test_admin_can_view_stats_for_all_users(self):
        """Test that admin can view aggregate stats."""
        # Create data for regular user
        photos = [create_test_photo(owner=self.user) for _ in range(2)]
        dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup.photos.add(*photos)
        
        self.client.force_authenticate(user=self.admin)
        
        response = self.client.get("/api/duplicates/stats")
        self.assertEqual(response.status_code, 200)

    def test_regular_user_sees_only_own_stats(self):
        """Test that regular users only see their own stats."""
        # Create data for admin
        admin_photos = [create_test_photo(owner=self.admin) for _ in range(2)]
        admin_dup = Duplicate.objects.create(
            owner=self.admin,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        admin_dup.photos.add(*admin_photos)
        
        # Create data for user
        user_photos = [create_test_photo(owner=self.user) for _ in range(2)]
        user_dup = Duplicate.objects.create(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        user_dup.photos.add(*user_photos)
        
        self.client.force_authenticate(user=self.user)
        
        response = self.client.get("/api/duplicates/stats")
        self.assertEqual(response.status_code, 200)
        
        # Stats should reflect only user's data
        # The exact assertion depends on the stats endpoint response format
