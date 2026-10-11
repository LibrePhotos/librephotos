"""
API Robustness and Security Tests

Tests designed to break the API with:
- Malformed inputs
- Invalid UUIDs and identifiers
- Extremely long strings
- Special characters and Unicode
- Missing required fields
- Invalid data types
- Boundary conditions
"""

import uuid

from django.test import TestCase
from rest_framework import status
from rest_framework.test import APIClient

from api.models.duplicate import Duplicate
from api.models.photo_stack import PhotoStack
from api.tests.utils import (
    create_test_duplicate,
    create_test_photo,
    create_test_stack,
    create_test_user,
)


class DuplicatesAPIRobustnessTestCase(TestCase):
    """Robustness tests for the Duplicates API."""

    def setUp(self):
        """Create test user and authenticate."""
        self.user = create_test_user(username="robusttest")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_resolve_with_empty_body(self):
        """Should handle empty request body gracefully."""
        # Create a duplicate
        duplicate = create_test_duplicate(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )

        response = self.client.post(
            f"/api/duplicates/{duplicate.id}/resolve/",
            data={},
            format="json",
        )
        # Should return error, not crash
        self.assertIn(response.status_code, [400, 422])

    def test_resolve_with_invalid_photo_id(self):
        """Should handle invalid photo ID gracefully."""
        duplicate = create_test_duplicate(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )

        response = self.client.post(
            f"/api/duplicates/{duplicate.id}/resolve/",
            data={"photo_id": "not-a-valid-uuid"},
            format="json",
        )
        self.assertIn(response.status_code, [400, 404])

    def test_resolve_with_nonexistent_photo(self):
        """Should handle nonexistent photo ID."""
        duplicate = create_test_duplicate(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        fake_uuid = str(uuid.uuid4())

        response = self.client.post(
            f"/api/duplicates/{duplicate.id}/resolve/",
            data={"photo_id": fake_uuid},
            format="json",
        )
        self.assertIn(response.status_code, [400, 404])

    def test_access_nonexistent_duplicate(self):
        """Should return 404 for nonexistent duplicate."""
        fake_uuid = str(uuid.uuid4())

        response = self.client.get(f"/api/duplicates/{fake_uuid}/")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_delete_nonexistent_duplicate(self):
        """Should return 404 for deleting nonexistent duplicate."""
        fake_uuid = str(uuid.uuid4())

        # Actual delete URL is /api/duplicates/<id>/delete with DELETE method
        response = self.client.delete(f"/api/duplicates/{fake_uuid}/delete")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_list_with_invalid_status_filter(self):
        """Should handle invalid status filter gracefully."""
        response = self.client.get("/api/duplicates/?status=invalid_status")
        # Should either ignore invalid filter or return error
        self.assertIn(response.status_code, [200, 400])

    def test_list_with_invalid_type_filter(self):
        """Should handle invalid type filter gracefully."""
        response = self.client.get("/api/duplicates/?type=nonexistent_type")
        self.assertIn(response.status_code, [200, 400])

    def test_extremely_long_string_in_query(self):
        """Should handle extremely long query strings."""
        long_string = "a" * 10000
        response = self.client.get(f"/api/duplicates/?status={long_string}")
        # Should not crash
        self.assertIn(response.status_code, [200, 400, 414])

    def test_special_characters_in_query(self):
        """Should handle special characters in query params."""
        response = self.client.get("/api/duplicates/?status=<script>alert(1)</script>")
        self.assertIn(response.status_code, [200, 400])

    def test_unicode_in_query(self):
        """Should handle unicode characters in query params."""
        response = self.client.get("/api/duplicates/?status=状态")
        self.assertIn(response.status_code, [200, 400])

    def test_null_bytes_in_request(self):
        """Should handle null bytes in request data."""
        duplicate = create_test_duplicate(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )

        response = self.client.post(
            f"/api/duplicates/{duplicate.id}/resolve/",
            data={"photo_id": "test\x00injection"},
            format="json",
        )
        self.assertIn(response.status_code, [400, 404])


class StacksAPIRobustnessTestCase(TestCase):
    """Robustness tests for the Stacks API."""

    def setUp(self):
        """Create test user and authenticate."""
        self.user = create_test_user(username="stackrobust")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_create_manual_stack_with_empty_photos(self):
        """Should reject creating stack with no photos."""
        # Actual URL is /api/stacks/manual
        response = self.client.post(
            "/api/stacks/manual",
            data={"photo_ids": []},
            format="json",
        )
        self.assertIn(response.status_code, [400, 422])

    def test_create_manual_stack_with_single_photo(self):
        """Should reject creating stack with only one photo."""
        photo = create_test_photo(owner=self.user)

        response = self.client.post(
            "/api/stacks/manual",
            data={"photo_ids": [str(photo.pk)]},
            format="json",
        )
        # Stack needs at least 2 photos
        self.assertIn(response.status_code, [400, 422])

    def test_create_manual_stack_with_invalid_photo_ids(self):
        """Should handle invalid photo IDs."""
        response = self.client.post(
            "/api/stacks/manual",
            data={"photo_ids": ["not-uuid", "also-not-uuid"]},
            format="json",
        )
        self.assertIn(response.status_code, [400, 404])

    def test_create_manual_stack_with_nonexistent_photos(self):
        """Should handle nonexistent photo IDs."""
        fake_uuids = [str(uuid.uuid4()), str(uuid.uuid4())]

        response = self.client.post(
            "/api/stacks/manual",
            data={"photo_ids": fake_uuids},
            format="json",
        )
        self.assertIn(response.status_code, [400, 404])

    def test_create_manual_stack_with_other_user_photos(self):
        """Should reject using another user's photos."""
        other_user = create_test_user(username="otheruser")
        other_photo = create_test_photo(owner=other_user)
        my_photo = create_test_photo(owner=self.user)

        response = self.client.post(
            "/api/stacks/manual",
            data={"photo_ids": [str(my_photo.pk), str(other_photo.pk)]},
            format="json",
        )
        # Should reject or ignore other user's photo
        self.assertIn(response.status_code, [400, 403, 404])

    def test_set_primary_with_photo_not_in_stack(self):
        """Should reject setting primary to photo not in stack."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)
        photo3 = create_test_photo(owner=self.user)

        stack = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        photo1.stacks.add(stack)
        photo2.stacks.add(stack)
        # photo3 is NOT in stack

        # Actual URL is /api/stacks/<id>/primary
        response = self.client.post(
            f"/api/stacks/{stack.id}/primary",
            data={"photo_id": str(photo3.pk)},
            format="json",
        )
        self.assertIn(response.status_code, [400, 404])

    def test_add_photo_to_nonexistent_stack(self):
        """Should return 404 for adding to nonexistent stack."""
        photo = create_test_photo(owner=self.user)
        fake_uuid = str(uuid.uuid4())

        # Actual URL is /api/stacks/<id>/add (no trailing slash)
        response = self.client.post(
            f"/api/stacks/{fake_uuid}/add",
            data={"photo_ids": [str(photo.pk)]},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_remove_all_photos_from_stack(self):
        """Should handle removing all photos (stack should be deleted or empty)."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)

        stack = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        photo1.stacks.add(stack)
        photo2.stacks.add(stack)

        # Actual URL is /api/stacks/<id>/remove
        response = self.client.post(
            f"/api/stacks/{stack.id}/remove",
            data={"photo_ids": [str(photo1.pk), str(photo2.pk)]},
            format="json",
        )
        # Stack API may reject removing all photos (requires at least 2) or delete stack
        self.assertIn(response.status_code, [200, 204, 400])

    def test_merge_stacks_with_empty_list(self):
        """Should reject merging with empty stack list."""
        response = self.client.post(
            "/api/stacks/merge/",
            data={"stack_ids": []},
            format="json",
        )
        self.assertIn(response.status_code, [400, 422])

    def test_merge_single_stack(self):
        """Should reject merging with only one stack."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)

        stack = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        photo1.stacks.add(stack)
        photo2.stacks.add(stack)

        response = self.client.post(
            "/api/stacks/merge/",
            data={"stack_ids": [str(stack.id)]},
            format="json",
        )
        self.assertIn(response.status_code, [400, 422])

    def test_list_with_invalid_stack_type_filter(self):
        """Should handle invalid stack type filter."""
        response = self.client.get("/api/stacks/?stack_type=invalid_type")
        self.assertIn(response.status_code, [200, 400])


class PhotoMetadataAPIRobustnessTestCase(TestCase):
    """Robustness tests for the PhotoMetadata API."""

    def setUp(self):
        """Create test user, photo, and authenticate."""
        self.user = create_test_user(username="metarobust")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

        self.photo = create_test_photo(owner=self.user)

    def test_update_with_invalid_field_types(self):
        """Test behavior with invalid field types - API may accept string and try to convert."""
        response = self.client.patch(
            f"/api/photos/{self.photo.pk}/metadata/",
            data={"iso": "not-a-number"},  # ISO should be int
            format="json",
        )
        # Note: API may accept this (Django models can coerce types) or reject
        self.assertIn(response.status_code, [200, 400, 422])

    def test_update_with_negative_values(self):
        """Should handle negative values for normally positive fields."""
        response = self.client.patch(
            f"/api/photos/{self.photo.pk}/metadata/",
            data={"iso": -100},
            format="json",
        )
        # May accept (no validation) or reject
        self.assertIn(response.status_code, [200, 400])

    def test_update_with_extremely_large_numbers(self):
        """Should handle extremely large numbers."""
        response = self.client.patch(
            f"/api/photos/{self.photo.pk}/metadata/",
            data={"iso": 999999999999999999},
            format="json",
        )
        self.assertIn(response.status_code, [200, 400])

    def test_update_nonexistent_photo_metadata(self):
        """Should return 404 for nonexistent photo."""
        fake_uuid = str(uuid.uuid4())

        response = self.client.patch(
            f"/api/photos/{fake_uuid}/metadata/",
            data={"camera": "Test Camera"},
            format="json",
        )
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_update_other_user_photo_metadata(self):
        """Should reject updating another user's photo metadata."""
        other_user = create_test_user(username="othermetauser")
        other_photo = create_test_photo(owner=other_user)

        response = self.client.patch(
            f"/api/photos/{other_photo.pk}/metadata/",
            data={"camera": "Hacked Camera"},
            format="json",
        )
        self.assertIn(response.status_code, [403, 404])

    def test_revert_nonexistent_edit(self):
        """Should return 404 for reverting nonexistent edit."""
        fake_uuid = str(uuid.uuid4())

        response = self.client.post(
            f"/api/photos/{self.photo.pk}/metadata/revert/{fake_uuid}/",
        )
        self.assertIn(response.status_code, [404, 405])


class AuthenticationRobustnessTestCase(TestCase):
    """Tests for authentication edge cases."""

    def setUp(self):
        """Create test user."""
        self.user = create_test_user(username="authtest")
        self.client = APIClient()

    def test_unauthenticated_access_to_duplicates(self):
        """Should reject unauthenticated access."""
        response = self.client.get("/api/duplicates/")
        self.assertIn(response.status_code, [401, 403])

    def test_unauthenticated_access_to_stacks(self):
        """Should reject unauthenticated access."""
        response = self.client.get("/api/stacks/")
        self.assertIn(response.status_code, [401, 403])

    def test_unauthenticated_detect_duplicates(self):
        """Should reject unauthenticated duplicate detection."""
        response = self.client.post("/api/duplicates/detect/")
        self.assertIn(response.status_code, [401, 403])

    def test_unauthenticated_detect_stacks(self):
        """Should reject unauthenticated stack detection."""
        response = self.client.post("/api/stacks/detect/")
        self.assertIn(response.status_code, [401, 403])


class ConcurrentOperationsTestCase(TestCase):
    """Tests for potential race conditions and concurrent operations."""

    def setUp(self):
        """Create test user and authenticate."""
        self.user = create_test_user(username="concurrent")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_delete_already_deleted_duplicate(self):
        """Should handle deleting an already-deleted duplicate."""
        duplicate = create_test_duplicate(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        dup_id = duplicate.id

        # First delete
        duplicate.delete()

        # Second delete attempt via API - DELETE method
        response = self.client.delete(f"/api/duplicates/{dup_id}/delete")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_delete_already_deleted_stack(self):
        """Should handle deleting an already-deleted stack."""
        photo = create_test_photo(owner=self.user)
        stack = create_test_stack(
            owner=self.user,
            stack_type=PhotoStack.StackType.MANUAL,
        )
        photo.stacks.add(stack)
        stack_id = stack.id

        # First delete
        stack.delete()

        # Second delete attempt via API - DELETE method
        response = self.client.delete(f"/api/stacks/{stack_id}/delete")
        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_resolve_already_resolved_duplicate(self):
        """Should handle resolving an already-resolved duplicate."""
        photo1 = create_test_photo(owner=self.user)
        photo2 = create_test_photo(owner=self.user)

        duplicate = create_test_duplicate(
            owner=self.user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
        )
        photo1.duplicates.add(duplicate)
        photo2.duplicates.add(duplicate)

        # Resolve first time
        duplicate.resolve(photo1, trash_others=True)

        # Resolve second time via API
        response = self.client.post(
            f"/api/duplicates/{duplicate.id}/resolve/",
            data={"photo_id": str(photo2.pk)},
            format="json",
        )
        # Should either succeed (re-resolve) or return appropriate error
        self.assertIn(response.status_code, [200, 400])


class BoundaryConditionsTestCase(TestCase):
    """Tests for boundary conditions and limits."""

    def setUp(self):
        """Create test user and authenticate."""
        self.user = create_test_user(username="boundary")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_pagination_with_zero_page(self):
        """Should handle page=0 gracefully."""
        response = self.client.get("/api/duplicates/?page=0")
        self.assertIn(response.status_code, [200, 400])

    def test_pagination_with_negative_page(self):
        """Should handle negative page number."""
        response = self.client.get("/api/duplicates/?page=-1")
        self.assertIn(response.status_code, [200, 400])

    def test_pagination_with_very_large_page(self):
        """Should handle very large page number."""
        response = self.client.get("/api/duplicates/?page=999999999")
        # Should return empty results, not crash
        self.assertIn(response.status_code, [200, 404])

    def test_pagination_with_invalid_page_size(self):
        """Should handle invalid page size - fixed by clamping to valid range."""
        # Was Bug #10: Negative page_size caused unhandled EmptyPage exception
        # Fixed by adding max(1, ...) to page_size validation
        response = self.client.get("/api/duplicates/?page_size=-10")
        self.assertEqual(response.status_code, status.HTTP_200_OK)

    def test_pagination_with_extremely_large_page_size(self):
        """Should limit extremely large page size."""
        response = self.client.get("/api/duplicates/?page_size=1000000")
        # Should limit or return error
        self.assertIn(response.status_code, [200, 400])

    def test_stacks_pagination_with_zero_page(self):
        """Should handle page=0 for stacks."""
        response = self.client.get("/api/stacks/?page=0")
        self.assertIn(response.status_code, [200, 400])


class MalformedRequestTestCase(TestCase):
    """Tests for malformed HTTP requests."""

    def setUp(self):
        """Create test user and authenticate."""
        self.user = create_test_user(username="malformed")
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def test_post_with_invalid_json(self):
        """Should handle invalid JSON gracefully."""
        response = self.client.post(
            "/api/stacks/manual",
            data="not valid json{{{",
            content_type="application/json",
        )
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_post_with_wrong_content_type(self):
        """Should handle wrong content type."""
        response = self.client.post(
            "/api/stacks/manual",
            data="photo_ids=abc",
            content_type="text/plain",
        )
        self.assertIn(response.status_code, [400, 415])

    def test_get_with_duplicate_query_params(self):
        """Should handle duplicate query parameters."""
        response = self.client.get("/api/duplicates/?status=pending&status=resolved")
        # Should not crash - may use first, last, or combine
        self.assertIn(response.status_code, [200, 400])
