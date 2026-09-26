"""The face list a photo shows in the lightbox sidebar.

``GET /api/photos/<image_hash>/`` renders ``PhotoSerializer.people``, which is
what the lightbox sidebar lists next to a photo and what drives the face box
drawn over the image. Three properties matter to that view and are pinned here:

* a face the owner deleted is gone from it,
* a face nobody has named yet is still in it (that row is the only place a face
  the algorithms gave up on can be named), and
* every entry carries a distinct ``face_id`` for the UI to key and act on.
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

LABEL_FACES_URL = "/api/labelfaces"


class PhotoPeopleListTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user)

    def _people(self):
        response = self.client.get(f"/api/photos/{self.photo.image_hash}/")
        self.assertEqual(response.status_code, 200)
        return response.data["people"]

    def test_deleted_face_is_not_listed_on_the_photo(self):
        """Deleting a face hides it from the dashboard and the person's list.

        The photo's own list used to keep showing it, so a misdetection the user
        had already dealt with came back on every visit to the photo.
        """
        create_test_face(
            photo=self.photo, person=create_test_person(name="Ghost"), deleted=True
        )

        self.assertEqual(self._people(), [])

    def test_deleted_face_does_not_hide_the_live_faces_beside_it(self):
        create_test_face(
            photo=self.photo, person=create_test_person(name="Ghost"), deleted=True
        )
        live = create_test_face(
            photo=self.photo, person=create_test_person(name="Alice")
        )

        people = self._people()

        self.assertEqual([p["name"] for p in people], ["Alice"])
        self.assertEqual(people[0]["face_id"], live.id)

    def test_deleted_unnamed_face_is_not_listed_either(self):
        create_test_face(
            photo=self.photo,
            person=None,
            cluster_person=None,
            classification_person=None,
            deleted=True,
        )

        self.assertEqual(self._people(), [])

    def test_unnamed_face_is_still_listed_with_an_empty_name(self):
        """The sidebar needs this row: it is where an unnamed face gets named."""
        face = create_test_face(
            photo=self.photo,
            person=None,
            cluster_person=None,
            classification_person=None,
        )

        people = self._people()

        self.assertEqual(len(people), 1)
        self.assertEqual(people[0]["name"], "")
        self.assertEqual(people[0]["type"], "")
        self.assertEqual(people[0]["face_id"], face.id)

    def test_every_entry_has_its_own_face_id(self):
        """Several unnamed faces share a name, so the id is the only unique key."""
        faces = [
            create_test_face(
                photo=self.photo,
                person=None,
                cluster_person=None,
                classification_person=None,
            )
            for _ in range(3)
        ]

        people = self._people()

        self.assertEqual([p["name"] for p in people], ["", "", ""])
        self.assertEqual(
            sorted(p["face_id"] for p in people), sorted(f.id for f in faces)
        )

    def test_face_location_is_exposed_for_the_overlay(self):
        create_test_face(
            photo=self.photo,
            person=create_test_person(name="Alice"),
            location_top=10,
            location_right=90,
            location_bottom=100,
            location_left=20,
        )

        location = self._people()[0]["location"]

        self.assertEqual(location, {"top": 10, "bottom": 100, "left": 20, "right": 90})


class LabelFacesPersonNameValidationTest(TestCase):
    """``POST /api/labelfaces`` must not be talked into a nameless person.

    ``Person.name`` carries a ``MinLengthValidator``, but the endpoint reaches
    the row through ``get_or_create()``, which does not run field validators.
    An unnamed face in the sidebar reported ``name: ""``, and the confirm button
    posted that name straight back - creating a person with no name, and a
    person album to go with it.
    """

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user)
        self.face = create_test_face(photo=self.photo, person=None)

    def _post(self, person_name):
        return self.client.post(
            LABEL_FACES_URL,
            {"face_ids": [self.face.id], "person_name": person_name},
            format="json",
        )

    def test_empty_person_name_is_rejected(self):
        response = self._post("")

        self.assertEqual(response.status_code, 400)
        self.assertFalse(Person.objects.filter(name="").exists())
        self.face.refresh_from_db()
        self.assertIsNone(self.face.person)

    def test_whitespace_only_person_name_is_rejected(self):
        response = self._post("   ")

        self.assertEqual(response.status_code, 400)
        self.assertFalse(
            Person.objects.filter(cluster_owner=self.user, kind=Person.KIND_USER)
            .exclude(name__regex=r"\S")
            .exists()
        )
        self.face.refresh_from_db()
        self.assertIsNone(self.face.person)

    def test_surrounding_whitespace_is_trimmed(self):
        """ " Alice " must not become a second person next to "Alice"."""
        self.assertEqual(self._post("Alice").status_code, 200)

        other_face = create_test_face(photo=self.photo, person=None)
        response = self.client.post(
            LABEL_FACES_URL,
            {"face_ids": [other_face.id], "person_name": "  Alice  "},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            Person.objects.filter(name="Alice", cluster_owner=self.user).count(), 1
        )
        self.assertEqual(
            Person.objects.filter(
                name__in=("  Alice  ", " Alice ", "Alice "), cluster_owner=self.user
            ).count(),
            0,
        )
        other_face.refresh_from_db()
        self.assertEqual(other_face.person.name, "Alice")

    def test_a_real_name_still_labels_the_face(self):
        response = self._post("Bob")

        self.assertEqual(response.status_code, 200)
        self.face.refresh_from_db()
        self.assertEqual(self.face.person.name, "Bob")
        self.assertEqual(self.face.person.kind, Person.KIND_USER)


class LabelFacesPseudoPersonNameTest(TestCase):
    """A cluster's name is not a person's name.

    Clustering names every unnamed cluster ``Unknown NNN`` and backs it with a
    ``Person`` row of kind ``CLUSTER``; the unclassifiable faces share one of
    kind ``UNKNOWN`` called "Unknown - Other". Those names reach the lightbox in
    the same ``name`` field a real person's name arrives in, and the confirm
    button posts whatever is there straight back here.

    ``get_or_create_person`` looks a row up by ``(name, cluster_owner, kind)``,
    so asking for ``KIND_USER`` never matches the ``CLUSTER`` row: it mints a
    *second* person called "Unknown 001", of the kind that gets a person album
    and trains the classifier, and moves the face onto it. The face dashboard
    has always hidden confirm for those kinds; the lightbox did not.
    """

    def setUp(self):
        self.client = APIClient()
        self.user = create_test_user()
        self.client.force_authenticate(user=self.user)
        self.photo = create_test_photo(owner=self.user)
        self.cluster_person = create_test_person(
            name="Unknown 001", kind=Person.KIND_CLUSTER, cluster_owner=self.user
        )
        self.face = create_test_face(
            photo=self.photo, person=None, cluster_person=self.cluster_person
        )

    def _post(self, person_name, face=None):
        return self.client.post(
            LABEL_FACES_URL,
            {"face_ids": [(face or self.face).id], "person_name": person_name},
            format="json",
        )

    def test_a_cluster_name_does_not_become_a_person(self):
        response = self._post("Unknown 001")

        self.assertEqual(response.status_code, 400)
        self.assertFalse(
            Person.objects.filter(
                name="Unknown 001", kind=Person.KIND_USER, cluster_owner=self.user
            ).exists()
        )
        self.assertEqual(Person.objects.filter(name="Unknown 001").count(), 1)

    def test_the_face_keeps_its_cluster_when_the_name_is_refused(self):
        self._post("Unknown 001")

        self.face.refresh_from_db()
        self.assertIsNone(self.face.person)
        self.assertEqual(self.face.cluster_person, self.cluster_person)

    def test_the_unknown_other_pseudo_person_still_unassigns(self):
        """The one pseudo-person name the endpoint already handled must keep
        working: posting it clears the face rather than labelling it."""
        response = self._post(Person.UNKNOWN_PERSON_NAME)

        self.assertEqual(response.status_code, 200)
        self.face.refresh_from_db()
        self.assertIsNone(self.face.person)
        self.assertIsNone(self.face.cluster_person)
        self.assertFalse(
            Person.objects.filter(
                name=Person.UNKNOWN_PERSON_NAME, kind=Person.KIND_USER
            ).exists()
        )

    def test_a_name_no_pseudo_person_holds_is_still_accepted(self):
        """The guard is about the rows that exist, not about names that look
        like a cluster's. Someone whose name happens to read that way, or a
        cluster number that was never created, must still label normally."""
        response = self._post("Unknown 042")

        self.assertEqual(response.status_code, 200)
        self.face.refresh_from_db()
        self.assertEqual(self.face.person.name, "Unknown 042")
        self.assertEqual(self.face.person.kind, Person.KIND_USER)

    def test_another_users_cluster_name_does_not_block_this_user(self):
        """Cluster names are per-owner, and so is the guard."""
        stranger = create_test_user()
        create_test_person(
            name="Unknown 007", kind=Person.KIND_CLUSTER, cluster_owner=stranger
        )

        response = self._post("Unknown 007")

        self.assertEqual(response.status_code, 200)
        self.face.refresh_from_db()
        self.assertEqual(self.face.person.kind, Person.KIND_USER)
        self.assertEqual(self.face.person.cluster_owner, self.user)

    def test_a_real_name_still_labels_a_clustered_face(self):
        response = self._post("Bob")

        self.assertEqual(response.status_code, 200)
        self.face.refresh_from_db()
        self.assertEqual(self.face.person.name, "Bob")
        self.assertEqual(self.face.person.kind, Person.KIND_USER)
