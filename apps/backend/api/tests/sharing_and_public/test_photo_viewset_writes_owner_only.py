"""Writes through ``/api/photos/<hash>/`` are the owner's alone, staff included.

``PhotoViewSet.get_permissions`` gave staff ``IsAdminUser`` for every write
action. That class only checks ``is_staff`` and has no object permission, so a
staff account could PATCH, PUT or DELETE any photo the viewset's queryset lets
it see: another user's public photos and photos shared to it. That meant
flipping ``public``/``hidden`` or deleting the row of a photo that is not
theirs. The branch came from 215c15e2a, which fixed ``[IsAdminUser or
IsOwnerOrReadOnly]`` (an expression that evaluates to ``IsAdminUser`` alone)
by keeping the admin half for staff; nothing in the web or mobile clients
writes through this endpoint (they use ``/api/photos/edit/``).

Every requester now goes through ``IsOwnerOrReadOnly`` for writes. A photo
the requester can read but does not own answers 403, as it already did for a
share recipient: the requester can GET it, so a 403 reveals nothing, while a
photo they cannot see stays a 404 from the queryset. Writes also require
authentication, so an anonymous POST no longer reaches ``create()`` (where it
failed with a 500 in ``Photo.save`` for want of an owner).
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import Photo
from api.tests.utils import create_test_photo, create_test_user


class PhotoViewSetWritesOwnerOnlyTest(TestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.admin = create_test_user(is_admin=True)
        self.stranger = create_test_user()
        self.public_photo = self.make_public()
        self.shared_photo = self.make_shared()
        self.private_photo = self.make_private()
        self.client = APIClient()

    # One fresh photo per write: a PATCH that got through hides the photo, and
    # the next method would then 404 on it rather than show its own result.
    def make_public(self):
        return create_test_photo(owner=self.owner, public=True, rating=2)

    def make_shared(self):
        photo = create_test_photo(owner=self.owner, rating=2)
        photo.shared_to.add(self.admin, self.stranger)
        return photo

    def make_private(self):
        return create_test_photo(owner=self.owner, rating=2)

    @staticmethod
    def url(photo):
        return f"/api/photos/{photo.image_hash}/"

    def send(self, method, photo):
        payload = {"rating": 5, "hidden": True, "public": not photo.public}
        if method == "DELETE":
            return self.client.delete(self.url(photo))
        return getattr(self.client, method.lower())(
            self.url(photo), payload, format="json"
        )

    def assert_untouched(self, photo):
        current = Photo.objects.filter(pk=photo.pk).first()
        self.assertIsNotNone(current, "photo was deleted")
        self.assertEqual(current.rating, 2)
        self.assertFalse(current.hidden)
        self.assertEqual(current.public, photo.public)

    def assert_writes_refused(self, user, make_photo, expected_status):
        self.client.force_authenticate(user=user)
        for method in ("PATCH", "PUT", "DELETE"):
            with self.subTest(method=method):
                photo = make_photo()
                response = self.send(method, photo)
                self.assertEqual(response.status_code, expected_status)
                self.assert_untouched(photo)

    def test_staff_cannot_write_another_users_public_photo(self):
        self.assert_writes_refused(self.admin, self.make_public, 403)

    def test_staff_cannot_write_a_photo_shared_to_them(self):
        self.assert_writes_refused(self.admin, self.make_shared, 403)

    def test_staff_cannot_reach_another_users_private_photo(self):
        self.assert_writes_refused(self.admin, self.make_private, 404)

    def test_non_owner_cannot_write_a_public_photo(self):
        self.assert_writes_refused(self.stranger, self.make_public, 403)

    def test_non_owner_cannot_write_a_photo_shared_to_them(self):
        self.assert_writes_refused(self.stranger, self.make_shared, 403)

    def test_anonymous_cannot_write_a_public_photo(self):
        self.assert_writes_refused(None, self.make_public, 401)

    def test_anonymous_create_is_refused(self):
        self.client.force_authenticate(user=None)
        before = Photo.objects.count()
        response = self.client.post(
            "/api/photos/", {"image_hash": "0" * 32, "rating": 3}, format="json"
        )
        self.assertEqual(response.status_code, 401)
        self.assertEqual(Photo.objects.count(), before)

    def test_staff_and_share_recipients_still_read(self):
        for user, photo in (
            (self.admin, self.public_photo),
            (self.admin, self.shared_photo),
            (self.stranger, self.shared_photo),
        ):
            with self.subTest(user=user.username, photo=photo.image_hash):
                self.client.force_authenticate(user=user)
                self.assertEqual(self.client.get(self.url(photo)).status_code, 200)
        self.client.force_authenticate(user=None)
        self.assertEqual(self.client.get(self.url(self.public_photo)).status_code, 200)

    def test_owner_can_still_patch_and_delete(self):
        self.client.force_authenticate(user=self.owner)
        response = self.client.patch(
            self.url(self.shared_photo), {"rating": 5}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.shared_photo.refresh_from_db()
        self.assertEqual(self.shared_photo.rating, 5)

        response = self.client.delete(self.url(self.private_photo))
        self.assertEqual(response.status_code, 204)
        self.assertFalse(Photo.objects.filter(pk=self.private_photo.pk).exists())

    def test_staff_owner_can_still_patch_their_own_photo(self):
        own = create_test_photo(owner=self.admin, rating=2)
        self.client.force_authenticate(user=self.admin)
        response = self.client.patch(self.url(own), {"rating": 5}, format="json")
        self.assertEqual(response.status_code, 200)
        own.refresh_from_db()
        self.assertEqual(own.rating, 5)
