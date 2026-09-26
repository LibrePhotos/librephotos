"""Issue #2047 - the person cover-face fallback must stay inside one library.

``PersonViewSet`` annotates the values ``PersonSerializer`` needs off the
person's *first face*, so that a people page costs a constant number of queries
(#618, #2042). ``cluster_owner`` scopes the **person**, not its faces, so the
subquery that picks that face has to be scoped separately -- otherwise a face
attached from another user's photo puts that photo's image hash into this
user's people list.

Not a regression: the subquery reproduced the older ``obj.faces.first()``
exactly. It is pinned here because the leak is silent -- the response is a
normal 200 carrying somebody else's hash.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import Person
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


class PersonCoverFaceOwnerScopingTest(TestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.stranger = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.owner)

        self.person = create_test_person(
            kind=Person.KIND_USER, cluster_owner=self.owner, face_count=2
        )
        # The stranger's face is created first, so it wins `order_by("id")`
        # and is the one an unscoped subquery would pick.
        self.stranger_photo = create_test_photo(owner=self.stranger, video=False)
        self.stranger_face = create_test_face(
            photo=self.stranger_photo, person=self.person, image="stranger.jpg"
        )
        self.owner_photo = create_test_photo(owner=self.owner, video=False)
        self.owner_face = create_test_face(
            photo=self.owner_photo, person=self.person, image="mine.jpg"
        )

    def _person_payload(self):
        response = self.client.get("/api/persons/")
        self.assertEqual(response.status_code, 200)
        body = response.json()
        rows = body["results"] if isinstance(body, dict) else body
        matching = [row for row in rows if row["id"] == self.person.id]
        self.assertEqual(len(matching), 1, rows)
        return matching[0]

    def test_the_cover_face_comes_from_the_requesters_own_photo(self):
        payload = self._person_payload()
        self.assertIn("mine.jpg", payload["face_url"])
        self.assertNotIn("stranger.jpg", payload["face_url"])

    def test_another_users_image_hash_is_not_exposed(self):
        payload = self._person_payload()
        self.assertEqual(payload["face_photo_url"], self.owner_photo.image_hash)
        self.assertNotEqual(payload["face_photo_url"], self.stranger_photo.image_hash)

    def test_a_person_with_only_another_users_faces_has_no_cover(self):
        # Nothing of the stranger's leaks in as a fallback either.
        self.owner_face.delete()
        payload = self._person_payload()
        self.assertEqual(payload["face_url"], "")
        self.assertEqual(payload["face_photo_url"], "")
