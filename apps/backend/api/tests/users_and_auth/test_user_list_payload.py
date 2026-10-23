"""The counts and public samples of every user endpoint, pinned (#2331).

The user list used to count and sample each user's photos with queries of its
own, three per user. They are annotated and prefetched by the view now; these
tests hold the payloads to what the per-row queries returned, on the list (for
admins, signed-in users and visitors), on retrieve, and on the responses of
create and both edits, which serialize a single user.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import User
from api.tests.utils import create_password, create_test_photo, create_test_user

SAMPLE_FIELDS = {"image_hash", "rating", "hidden", "exif_timestamp", "public", "video"}


def _client(user: User | None = None) -> APIClient:
    client = APIClient()
    if user is not None:
        client.force_authenticate(user=user)
    return client


class UserPayloadTest(TestCase):
    def setUp(self):
        self.admin = create_test_user(is_admin=True)
        self.owner = create_test_user(public_sharing=True)
        self.public = [
            create_test_photo(owner=self.owner, public=True, rating=index)
            for index in range(2)
        ]
        create_test_photo(owner=self.owner)  # visible, private
        hidden = create_test_photo(owner=self.owner, public=True)
        hidden.hidden = True
        hidden.save(update_fields=["hidden"])
        # More public photos than the ten samples: the cap is per user.
        self.prolific = create_test_user(public_sharing=True)
        for _ in range(12):
            create_test_photo(owner=self.prolific, public=True)
        self.private = create_test_user()
        create_test_photo(owner=self.private, public=True)

    def _rows(self, client: APIClient) -> dict[int, dict]:
        response = client.get("/api/user/")
        self.assertEqual(response.status_code, 200)
        return {row["id"]: row for row in response.json()["results"]}

    def _assert_samples(self, row: dict, photos: list, public: bool = False) -> None:
        """``public``: as everyone else sees the card, without ratings (the
        public sharing switches decide, ``api.sharing.grants.SAMPLE_FIELDS``)."""
        self.assertEqual(
            sorted(sample["image_hash"] for sample in row["public_photo_samples"]),
            sorted(photo.image_hash for photo in photos),
        )
        by_hash = {photo.image_hash: photo for photo in photos}
        for sample in row["public_photo_samples"]:
            self.assertEqual(set(sample), SAMPLE_FIELDS)
            photo = by_hash[sample["image_hash"]]
            self.assertEqual(sample["rating"], 0 if public else photo.rating)
            self.assertIs(sample["public"], True)
            self.assertIs(sample["hidden"], False)
            self.assertIs(sample["video"], False)

    def _assert_public_rows(self, rows: dict[int, dict], public: bool = False) -> None:
        owner = rows[self.owner.id]
        self.assertEqual(owner["public_photo_count"], 2)
        self._assert_samples(owner, self.public, public)
        prolific = rows[self.prolific.id]
        self.assertEqual(prolific["public_photo_count"], 12)
        self.assertEqual(len(prolific["public_photo_samples"]), 10)

    def test_admin_list(self):
        rows = self._rows(_client(self.admin))
        self._assert_public_rows(rows)
        self.assertEqual(rows[self.owner.id]["photo_count"], 3)
        self.assertEqual(rows[self.prolific.id]["photo_count"], 12)
        self.assertEqual(rows[self.private.id]["photo_count"], 1)
        self.assertEqual(rows[self.private.id]["public_photo_count"], 1)
        self.assertEqual(rows[self.admin.id]["photo_count"], 0)
        self.assertEqual(rows[self.admin.id]["public_photo_samples"], [])

    def test_signed_in_list(self):
        rows = self._rows(_client(self.private))
        self._assert_public_rows(rows, public=True)
        self.assertNotIn("photo_count", rows[self.owner.id])
        self.assertEqual(rows[self.private.id]["public_photo_count"], 1)

    def test_visitor_list(self):
        rows = self._rows(_client())
        self._assert_public_rows(rows, public=True)
        self.assertNotIn(self.private.id, rows)

    def test_retrieve_own_record(self):
        response = _client(self.owner).get(f"/api/user/{self.owner.id}/")
        self.assertEqual(response.status_code, 200)
        row = response.json()
        self.assertEqual(row["photo_count"], 3)
        self.assertEqual(row["public_photo_count"], 2)
        self._assert_samples(row, self.public)

    def test_retrieve_another_user(self):
        response = _client().get(f"/api/user/{self.owner.id}/")
        self.assertEqual(response.status_code, 200)
        row = response.json()
        self.assertNotIn("photo_count", row)
        self.assertEqual(row["public_photo_count"], 2)
        self._assert_samples(row, self.public, public=True)

    def test_admin_creates_a_user(self):
        response = _client(self.admin).post(
            "/api/user/",
            {
                "username": "payload_new_user",
                "password": create_password(),
                "email": "payload_new_user@test.com",
            },
        )
        self.assertEqual(response.status_code, 201, response.content)
        row = response.json()
        self.assertEqual(row["photo_count"], 0)
        self.assertEqual(row["public_photo_count"], 0)
        self.assertEqual(row["public_photo_samples"], [])

    def test_own_edit(self):
        response = _client(self.owner).patch(
            f"/api/user/{self.owner.id}/", {"first_name": "Renamed"}
        )
        self.assertEqual(response.status_code, 200, response.content)
        row = response.json()
        self.assertEqual(row["first_name"], "Renamed")
        self.assertEqual(row["photo_count"], 3)
        self.assertEqual(row["public_photo_count"], 2)
        self._assert_samples(row, self.public)

    def test_admin_edit(self):
        response = _client(self.admin).patch(
            f"/api/manage/user/{self.owner.id}/", {"first_name": "Managed"}
        )
        self.assertEqual(response.status_code, 200, response.content)
        row = response.json()
        self.assertEqual(row["first_name"], "Managed")
        self.assertEqual(row["photo_count"], 3)
