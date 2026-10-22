"""The settings page saves the Public Sharing Defaults with the rest of the
profile, through PATCH /api/user/<id>/ (the whole edited profile).

``public_sharing_defaults`` was a serializer field but missing from the
fields ``UserSerializer.update`` copies onto the user, so the PATCH answered
200 and dropped it: a switch turned on in Settings was off again on reload,
and public links never shared what the owner chose.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import User
from api.models.user import get_default_public_sharing_settings
from api.tests.utils import create_test_user


class PublicSharingDefaultsSaveTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)

    def patch(self, value: object):
        return self.client.patch(
            f"/api/user/{self.user.id}/",
            {"public_sharing_defaults": value},
            format="json",
        )

    def saved(self) -> dict[str, bool]:
        return User.objects.get(id=self.user.id).public_sharing_defaults

    def test_patch_saves_the_switches(self):
        wanted = {
            **get_default_public_sharing_settings(),
            "share_location": True,
            "share_faces": True,
        }

        response = self.patch(wanted)

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self.saved(), wanted)
        self.assertEqual(response.json()["public_sharing_defaults"], wanted)

    def test_a_switch_can_be_turned_off_again(self):
        self.patch({**get_default_public_sharing_settings(), "share_captions": True})

        self.patch(get_default_public_sharing_settings())

        self.assertEqual(self.saved(), get_default_public_sharing_settings())

    def test_a_partial_object_keeps_the_other_switches(self):
        self.patch({**get_default_public_sharing_settings(), "share_location": True})

        response = self.patch({"share_timestamps": True})

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(
            self.saved(),
            {
                **get_default_public_sharing_settings(),
                "share_location": True,
                "share_timestamps": True,
            },
        )

    def test_an_unknown_switch_is_refused(self):
        response = self.patch({"share_everything": True})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.saved(), get_default_public_sharing_settings())

    def test_a_switch_that_is_not_a_boolean_is_refused(self):
        for value in ("yes", 1, None):
            with self.subTest(value=value):
                response = self.patch({"share_location": value})

                self.assertEqual(response.status_code, 400)
                self.assertEqual(self.saved(), get_default_public_sharing_settings())

    def test_something_other_than_an_object_is_refused(self):
        for value in (["share_location"], "share_location", True):
            with self.subTest(value=value):
                self.assertEqual(self.patch(value).status_code, 400)
