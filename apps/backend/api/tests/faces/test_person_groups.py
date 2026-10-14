"""Person groups (#1126): a user's own grouping of their people.

``/api/person-groups/`` lists, creates, renames and deletes the requester's
groups; ``PUT /api/persons/<id>/groups/`` sets which groups a person is in;
``?group=<id>`` narrows the People list and the face dashboard's people.
Another user's groups and people never show up and cannot be changed
(``test_cross_tenant_reads.py`` / ``test_cross_tenant_writes.py``).
"""

from django.db import IntegrityError, transaction
from django.test import TestCase
from rest_framework.test import APIClient

from api.faces.merge import merge_people
from api.models import Person, PersonGroup
from api.serializers.person import PersonSerializer
from api.tests.utils import (
    create_test_album_auto,
    create_test_face,
    create_test_person,
    create_test_person_group,
    create_test_photo,
    create_test_user,
)

GROUPS_URL = "/api/person-groups/"


def groups_of_url(person: Person) -> str:
    return f"/api/persons/{person.pk}/groups/"


def error_codes(response) -> list[str]:
    return [error["code"] for error in response.json()["errors"]]


class PersonGroupTestCase(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.other = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.anna = create_test_person(name="Anna", cluster_owner=self.user)
        self.ben = create_test_person(name="Ben", cluster_owner=self.user)
        for person in (self.anna, self.ben):
            create_test_face(photo=create_test_photo(owner=self.user), person=person)


class PersonGroupCrudTest(PersonGroupTestCase):
    def test_create_trims_the_name_and_answers_an_empty_group(self):
        response = self.client.post(GROUPS_URL, {"name": "  Family "}, format="json")
        self.assertEqual(response.status_code, 201, response.content)
        group = PersonGroup.objects.get(pk=response.json()["id"])
        self.assertEqual(group.owner, self.user)
        self.assertEqual(
            response.json(), {"id": group.pk, "name": "Family", "person_count": 0}
        )

    def test_a_blank_name_is_refused(self):
        response = self.client.post(GROUPS_URL, {"name": "   "}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(PersonGroup.objects.count(), 0)

    def test_a_name_taken_in_any_case_is_refused(self):
        create_test_person_group(owner=self.user, name="Family")
        response = self.client.post(GROUPS_URL, {"name": "FAMILY"}, format="json")
        self.assertEqual(response.status_code, 400)
        self.assertEqual(error_codes(response), ["unique"])

    def test_another_users_group_name_is_free(self):
        create_test_person_group(owner=self.other, name="Family")
        response = self.client.post(GROUPS_URL, {"name": "Family"}, format="json")
        self.assertEqual(response.status_code, 201)

    def test_the_database_refuses_a_duplicate_name_too(self):
        create_test_person_group(owner=self.user, name="Work")
        with self.assertRaises(IntegrityError), transaction.atomic():
            create_test_person_group(owner=self.user, name="work")

    def test_list_is_the_requesters_groups_by_name_with_person_counts(self):
        create_test_person_group(owner=self.user, name="work", persons=[self.anna])
        create_test_person_group(
            owner=self.user, name="Family", persons=[self.anna, self.ben]
        )
        create_test_person_group(owner=self.other, name="Club")
        response = self.client.get(GROUPS_URL)
        self.assertEqual(response.status_code, 200)
        rows = [
            (row["name"], row["person_count"]) for row in response.json()["results"]
        ]
        self.assertEqual(rows, [("Family", 2), ("work", 1)])

    def test_rename_keeps_the_people(self):
        group = create_test_person_group(
            owner=self.user, name="Famly", persons=[self.anna]
        )
        response = self.client.patch(
            f"{GROUPS_URL}{group.pk}/", {"name": "Family"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()["person_count"], 1)
        group.refresh_from_db()
        self.assertEqual(group.name, "Family")

    def test_rename_to_its_own_name_in_another_case_is_allowed(self):
        group = create_test_person_group(owner=self.user, name="family")
        response = self.client.patch(
            f"{GROUPS_URL}{group.pk}/", {"name": "Family"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)

    def test_rename_to_another_groups_name_is_refused(self):
        create_test_person_group(owner=self.user, name="Family")
        group = create_test_person_group(owner=self.user, name="Work")
        response = self.client.patch(
            f"{GROUPS_URL}{group.pk}/", {"name": "family"}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(error_codes(response), ["unique"])

    def test_delete_keeps_the_people(self):
        group = create_test_person_group(owner=self.user, persons=[self.anna])
        response = self.client.delete(f"{GROUPS_URL}{group.pk}/")
        self.assertEqual(response.status_code, 204)
        self.assertFalse(PersonGroup.objects.filter(pk=group.pk).exists())
        self.assertTrue(Person.objects.filter(pk=self.anna.pk).exists())

    def test_another_users_group_is_not_found(self):
        group = create_test_person_group(owner=self.other, name="Club")
        response = self.client.patch(
            f"{GROUPS_URL}{group.pk}/", {"name": "Mine"}, format="json"
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(
            self.client.delete(f"{GROUPS_URL}{group.pk}/").status_code, 404
        )


class SetPersonGroupsTest(PersonGroupTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.family = create_test_person_group(owner=self.user, name="Family")
        self.work = create_test_person_group(owner=self.user, name="Work")

    def test_put_sets_exactly_the_listed_groups(self):
        self.family.persons.add(self.anna)
        response = self.client.put(
            groups_of_url(self.anna), {"group_ids": [self.work.pk]}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"group_ids": [self.work.pk]})
        self.assertEqual(list(self.anna.groups.all()), [self.work])

    def test_an_empty_list_takes_the_person_out_of_every_group(self):
        self.family.persons.add(self.anna)
        response = self.client.put(
            groups_of_url(self.anna), {"group_ids": []}, format="json"
        )
        self.assertEqual(response.json(), {"group_ids": []})
        self.assertEqual(self.anna.groups.count(), 0)

    def test_only_the_changed_groups_get_a_new_last_modified(self):
        self.family.persons.add(self.anna)
        before = {group.pk: group.last_modified for group in PersonGroup.objects.all()}
        self.client.put(
            groups_of_url(self.anna),
            {"group_ids": [self.family.pk, self.work.pk]},
            format="json",
        )
        after = {group.pk: group.last_modified for group in PersonGroup.objects.all()}
        self.assertEqual(after[self.family.pk], before[self.family.pk])
        self.assertGreater(after[self.work.pk], before[self.work.pk])

    def test_another_users_group_is_refused(self):
        club = create_test_person_group(owner=self.other, name="Club")
        response = self.client.put(
            groups_of_url(self.anna), {"group_ids": [club.pk]}, format="json"
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.anna.groups.count(), 0)

    def test_another_users_person_is_not_found(self):
        theirs = create_test_person(name="Eve", cluster_owner=self.other)
        response = self.client.put(
            groups_of_url(theirs), {"group_ids": [self.family.pk]}, format="json"
        )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(theirs.groups.count(), 0)

    def test_a_merge_keeps_the_merged_persons_groups(self):
        self.family.persons.add(self.ben)
        self.work.persons.add(self.anna)
        merge_people(self.user, self.ben, self.anna)
        self.assertEqual(
            set(self.anna.groups.values_list("pk", flat=True)),
            {self.family.pk, self.work.pk},
        )


class GroupFilterTest(PersonGroupTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.family = create_test_person_group(
            owner=self.user, name="Family", persons=[self.anna]
        )

    def names(self, url: str) -> list[str]:
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        rows = body["results"] if isinstance(body, dict) else body
        return [row["name"] for row in rows]

    def test_people_carry_their_group_ids(self):
        rows = self.client.get("/api/persons/").json()["results"]
        self.assertEqual(
            {row["name"]: row["group_ids"] for row in rows},
            {"Anna": [self.family.pk], "Ben": []},
        )
        one = self.client.get(f"/api/persons/{self.anna.pk}/").json()
        self.assertEqual(one["group_ids"], [self.family.pk])

    def test_people_list_narrows_to_a_group(self):
        self.assertEqual(self.names(f"/api/persons/?group={self.family.pk}"), ["Anna"])

    def test_another_users_group_lists_nobody(self):
        club = create_test_person_group(owner=self.other, persons=[])
        self.assertEqual(self.names(f"/api/persons/?group={club.pk}"), [])

    def test_a_malformed_group_is_a_400(self):
        for value in ("0", "family"):
            with self.subTest(value=value):
                response = self.client.get(f"/api/persons/?group={value}")
                self.assertEqual(response.status_code, 400)

    def test_face_dashboard_narrows_its_people_and_keeps_unknown_last(self):
        create_test_face(photo=create_test_photo(owner=self.user))
        self.assertEqual(
            self.names("/api/faces/incomplete/"), ["Anna", "Ben", "Unknown - Other"]
        )
        self.assertEqual(
            self.names(f"/api/faces/incomplete/?group={self.family.pk}"),
            ["Anna", "Unknown - Other"],
        )

    def test_an_event_lists_its_peoples_group_ids(self):
        photo = create_test_photo(owner=self.user)
        create_test_face(photo=photo, person=self.anna)
        event = create_test_album_auto(owner=self.user)
        event.photos.add(photo)
        people = self.client.get(f"/api/albums/auto/{event.pk}/").json()["people"]
        self.assertEqual([person["group_ids"] for person in people], [[self.family.pk]])

    def test_a_person_serialized_on_its_own_reads_its_groups(self):
        self.assertEqual(
            PersonSerializer(self.anna).data["group_ids"], [self.family.pk]
        )
