"""``/api/library-shares/``: who may start, change and end a library share (#2731)."""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import LibraryShare
from api.tests.utils import (
    create_test_library_share,
    create_test_photo,
    create_test_user,
)

URL = "/api/library-shares/"


def client_for(user):
    client = APIClient()
    client.force_authenticate(user=user)
    return client


class LibraryShareApiTest(TestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.recipient = create_test_user()
        self.stranger = create_test_user()

    def test_the_owner_shares_with_every_switch_off(self):
        response = client_for(self.owner).post(
            URL, {"recipient_id": self.recipient.pk}, format="json"
        )
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertEqual(body["recipient"]["id"], self.recipient.pk)
        self.assertEqual(body["owner"]["id"], self.owner.pk)
        for switch in (
            "share_location",
            "share_faces",
            "share_camera_info",
            "share_captions",
            "share_originals",
            "show_in_timeline",
        ):
            self.assertIs(body[switch], False, switch)

    def test_the_owner_may_turn_switches_on_when_sharing(self):
        response = client_for(self.owner).post(
            URL,
            {"recipient_id": self.recipient.pk, "share_location": True},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertTrue(response.json()["share_location"])
        # The recipient's switch is not the owner's to set.
        self.assertFalse(response.json()["show_in_timeline"])

    def test_a_second_share_with_the_same_user_is_a_conflict(self):
        create_test_library_share(owner=self.owner, recipient=self.recipient)
        response = client_for(self.owner).post(
            URL, {"recipient_id": self.recipient.pk}, format="json"
        )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(response.json()["errors"][0]["code"], "library_already_shared")

    def test_sharing_with_oneself_or_nobody_is_refused(self):
        client = client_for(self.owner)
        for recipient_id in (self.owner.pk, 999999):
            with self.subTest(recipient_id=recipient_id):
                response = client.post(
                    URL, {"recipient_id": recipient_id}, format="json"
                )
                self.assertEqual(response.status_code, 400)
        inactive = create_test_user(is_active=False)
        response = client.post(URL, {"recipient_id": inactive.pk}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertFalse(LibraryShare.objects.exists())

    def test_both_sides_list_the_share_and_a_stranger_does_not(self):
        create_test_photo(owner=self.owner)
        create_test_photo(owner=self.owner, hidden=True)
        create_test_library_share(owner=self.owner, recipient=self.recipient)
        for user in (self.owner, self.recipient):
            with self.subTest(user=user.pk):
                rows = client_for(user).get(URL).json()["results"]
                self.assertEqual(len(rows), 1)
                # The hidden photo is not part of the share.
                self.assertEqual(rows[0]["photo_count"], 1)
        self.assertEqual(client_for(self.stranger).get(URL).json()["results"], [])
        self.assertEqual(APIClient().get(URL).status_code, 401)

    def test_the_owner_changes_what_the_recipient_sees(self):
        share = create_test_library_share(owner=self.owner, recipient=self.recipient)
        response = client_for(self.owner).patch(
            f"{URL}{share.pk}/",
            {"share_location": True, "share_originals": True},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        share.refresh_from_db()
        self.assertTrue(share.share_location)
        self.assertTrue(share.share_originals)

    def test_the_owner_cannot_put_the_library_in_the_recipients_timeline(self):
        share = create_test_library_share(owner=self.owner, recipient=self.recipient)
        response = client_for(self.owner).patch(
            f"{URL}{share.pk}/", {"show_in_timeline": True}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        share.refresh_from_db()
        self.assertFalse(share.show_in_timeline)

    def test_the_recipient_only_changes_the_timeline_switch(self):
        share = create_test_library_share(owner=self.owner, recipient=self.recipient)
        client = client_for(self.recipient)
        response = client.patch(
            f"{URL}{share.pk}/", {"show_in_timeline": True}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        response = client.patch(
            f"{URL}{share.pk}/", {"share_location": True}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        share.refresh_from_db()
        self.assertTrue(share.show_in_timeline)
        self.assertFalse(share.share_location)

    def test_a_stranger_gets_a_404_for_every_verb(self):
        share = create_test_library_share(owner=self.owner, recipient=self.recipient)
        client = client_for(self.stranger)
        response = client.patch(
            f"{URL}{share.pk}/", {"share_location": True}, format="json"
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(client.delete(f"{URL}{share.pk}/").status_code, 404)
        self.assertEqual(client.delete(f"{URL}abc/").status_code, 404)
        share.refresh_from_db()
        self.assertFalse(share.share_location)

    def test_the_owner_stops_sharing_and_the_recipient_leaves(self):
        for leaver in ("owner", "recipient"):
            with self.subTest(leaver=leaver):
                share = create_test_library_share(
                    owner=self.owner, recipient=self.recipient
                )
                user = self.owner if leaver == "owner" else self.recipient
                response = client_for(user).delete(f"{URL}{share.pk}/")
                self.assertEqual(response.status_code, 204)
                self.assertFalse(LibraryShare.objects.exists())
