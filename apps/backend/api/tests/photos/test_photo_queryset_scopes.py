"""The per-user scopes on the Photo manager, and the field built on them.

``Photo.objects.owned_by(user)`` is the write scope and
``Photo.objects.visible_to(user)`` the read scope. Views and serializers go
through these rather than spelling ``owner=request.user`` at each call site,
so a missing guard is a missing method call rather than a missing keyword.
"""

from django.contrib.auth.models import AnonymousUser
from django.test import TestCase
from rest_framework import serializers
from rest_framework.test import APIRequestFactory

from api.models import Photo
from api.serializers.fields import OwnedPhotoField
from api.tests.utils import create_test_photo, create_test_user


class PhotoOwnedByTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.other = create_test_user()
        self.mine = create_test_photo(owner=self.user)
        self.theirs_public = create_test_photo(owner=self.other, public=True)
        self.theirs_shared = create_test_photo(owner=self.other)
        self.theirs_shared.shared_to.add(self.user)

    def test_only_the_users_own_photos(self):
        self.assertEqual(
            set(Photo.objects.owned_by(self.user).values_list("id", flat=True)),
            {self.mine.id},
        )

    def test_anonymous_owns_nothing(self):
        self.assertFalse(Photo.objects.owned_by(AnonymousUser()).exists())
        self.assertFalse(Photo.objects.owned_by(None).exists())

    def test_available_on_the_visible_manager_too(self):
        hidden = create_test_photo(owner=self.user, hidden=True)
        ids = set(Photo.visible.owned_by(self.user).values_list("id", flat=True))
        self.assertIn(self.mine.id, ids)
        self.assertNotIn(hidden.id, ids)


class PhotoVisibleToTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.other = create_test_user()
        self.mine = create_test_photo(owner=self.user)
        self.theirs_private = create_test_photo(owner=self.other)
        self.theirs_public = create_test_photo(owner=self.other, public=True)
        self.theirs_shared = create_test_photo(owner=self.other)
        self.theirs_shared.shared_to.add(self.user)

    def _ids(self, user):
        return set(Photo.objects.visible_to(user).values_list("id", flat=True))

    def test_own_shared_and_public_photos(self):
        self.assertEqual(
            self._ids(self.user),
            {self.mine.id, self.theirs_public.id, self.theirs_shared.id},
        )

    def test_anonymous_sees_public_only(self):
        self.assertEqual(self._ids(AnonymousUser()), {self.theirs_public.id})
        self.assertEqual(self._ids(None), {self.theirs_public.id})


class _PhotoRefSerializer(serializers.Serializer):
    photo = OwnedPhotoField()
    photos = OwnedPhotoField(many=True)


class OwnedPhotoFieldTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.other = create_test_user()
        self.mine = create_test_photo(owner=self.user)
        self.theirs = create_test_photo(owner=self.other, public=True)

    def _validate(self, data, user):
        request = APIRequestFactory().post("/")
        request.user = user
        serializer = _PhotoRefSerializer(data=data, context={"request": request})
        return serializer.is_valid(), serializer.errors

    def test_own_photo_is_accepted(self):
        ok, errors = self._validate(
            {"photo": str(self.mine.id), "photos": [str(self.mine.id)]}, self.user
        )
        self.assertTrue(ok, errors)

    def test_foreign_photo_is_rejected_even_when_public(self):
        ok, errors = self._validate(
            {"photo": str(self.theirs.id), "photos": [str(self.mine.id)]}, self.user
        )
        self.assertFalse(ok)
        self.assertIn("photo", errors)

    def test_foreign_photo_in_a_list_fails_the_whole_field(self):
        ok, errors = self._validate(
            {
                "photo": str(self.mine.id),
                "photos": [str(self.mine.id), str(self.theirs.id)],
            },
            self.user,
        )
        self.assertFalse(ok)
        self.assertIn("photos", errors)

    def test_without_a_request_nothing_is_accepted(self):
        serializer = _PhotoRefSerializer(
            data={"photo": str(self.mine.id), "photos": [str(self.mine.id)]}
        )
        self.assertFalse(serializer.is_valid())
