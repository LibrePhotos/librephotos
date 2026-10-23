"""Sharing a person (#668), adversarially.

Anna shares Mila with Clara. Clara must see only the photos where Anna
labelled a face Mila and approved the photo: never a photo Mila was only
suggested on, never one labelled after the share until Anna reviews it,
never a hidden one, and nothing the moment Anna stops sharing or takes the
label off. What Clara sees of those photos is what Anna allows for Mila.
Mallory is nobody here.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import Person, PersonShare, PersonSharePhoto, Photo
from api.sharing.copies import COPIES_DIR
from api.tests.utils import (
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)


def _client(user):
    client = APIClient()
    if user is not None:
        client.force_authenticate(user=user)
    return client


class PersonSharingBase(TestCase):
    def setUp(self):
        self.anna = create_test_user()
        self.clara = create_test_user()
        self.mallory = create_test_user()
        self.mila = create_test_person(name="Mila", cluster_owner=self.anna)
        self.rex = create_test_person(name="Rex", cluster_owner=self.anna)
        self.labelled = create_test_photo(
            owner=self.anna, search_location="Dog Park", gps_lat=48.1, gps_lon=11.5
        )
        self.face = create_test_face(photo=self.labelled, person=self.mila)
        create_test_face(photo=self.labelled, person=self.rex)
        self.suggested = create_test_photo(owner=self.anna)
        create_test_face(
            photo=self.suggested,
            classification_person=self.mila,
            cluster_person=self.mila,
        )
        self.rex_only = create_test_photo(owner=self.anna)
        create_test_face(photo=self.rex_only, person=self.rex)

    def sharing_url(self, person=None, suffix=""):
        return f"/api/persons/{(person or self.mila).pk}/sharing/{suffix}"

    def share(self, recipients, **settings):
        response = _client(self.anna).put(
            self.sharing_url(),
            {"recipient_ids": [u.pk for u in recipients], **settings},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def label_later(self):
        later = create_test_photo(owner=self.anna)
        create_test_face(photo=later, person=self.mila)
        return later

    def people(self, user):
        return _client(user).get("/api/photos/shared/tome/people/").json()["results"]

    def mila_photos(self, user):
        response = _client(user).get(
            f"/api/photos/shared/tome/people/photos/?person={self.mila.pk}"
        )
        if response.status_code != 200:
            return response.status_code, {}
        return 200, {row["id"]: row for row in response.json()["results"]}

    def media(self, user, path, photo):
        return _client(user).get(f"/media/{path}/{photo.image_hash}")


class WhatTheRecipientSeesTest(PersonSharingBase):
    def test_only_the_photos_labelled_when_shared(self):
        body = self.share([self.clara])
        self.assertEqual((body["shared_count"], body["pending_count"]), (1, 0))
        self.assertEqual([u["id"] for u in body["recipients"]], [self.clara.pk])
        later = self.label_later()
        status, photos = self.mila_photos(self.clara)
        self.assertEqual(status, 200)
        self.assertEqual(set(photos), {str(self.labelled.pk)})
        self.assertNotIn(str(self.suggested.pk), photos)
        self.assertNotIn(str(later.pk), photos)
        people = {p["name"]: p["photo_count"] for p in self.people(self.clara)}
        self.assertEqual(people, {"Mila": 1})

    def test_media_and_detail_follow_the_same_rule(self):
        self.share([self.clara])
        later = self.label_later()
        self.assertEqual(
            self.media(self.clara, "thumbnails_big", self.labelled).status_code, 200
        )
        for photo in (self.suggested, self.rex_only, later):
            with self.subTest(photo=photo.pk):
                self.assertEqual(
                    self.media(self.clara, "thumbnails_big", photo).status_code, 404
                )
                self.assertEqual(
                    _client(self.clara).get(f"/api/photos/{photo.pk}/").status_code, 404
                )
        # The original carries its metadata: never served, at most the copy.
        response = self.media(self.clara, "photos", self.labelled)
        if response.status_code == 200:
            self.assertIn(COPIES_DIR, response["X-Accel-Redirect"])

    def test_location_and_other_names_only_when_the_owner_allows(self):
        self.share([self.clara])
        _, photos = self.mila_photos(self.clara)
        self.assertEqual(photos[str(self.labelled.pk)]["location"], "")
        detail = _client(self.clara).get(f"/api/photos/{self.labelled.pk}/").json()
        self.assertIsNone(detail["exif_gps_lat"])
        self.assertEqual(detail["people"], [])
        self.assertEqual(detail["image_path"], [])
        self.assertIsNone(detail["camera"])
        self.share([self.clara], share_location=True, share_other_people=True)
        _, photos = self.mila_photos(self.clara)
        self.assertEqual(photos[str(self.labelled.pk)]["location"], "Dog Park")
        detail = _client(self.clara).get(f"/api/photos/{self.labelled.pk}/").json()
        self.assertEqual(detail["exif_gps_lat"], 48.1)
        self.assertEqual({p["name"] for p in detail["people"]}, {"Mila", "Rex"})
        self.assertIsNone(detail["camera"])

    def test_a_stranger_sees_nothing(self):
        self.share([self.clara])
        self.assertEqual(self.people(self.mallory), [])
        self.assertEqual(self.mila_photos(self.mallory)[0], 404)
        self.assertEqual(
            self.media(self.mallory, "thumbnails_big", self.labelled).status_code, 404
        )
        self.assertEqual(
            _client(self.mallory).get(f"/api/photos/{self.labelled.pk}/").status_code,
            404,
        )


class ReviewTest(PersonSharingBase):
    def test_new_matches_wait_for_the_owner(self):
        self.share([self.clara])
        later = self.label_later()
        pending = _client(self.anna).get(self.sharing_url(suffix="pending/")).json()
        self.assertEqual([p["id"] for p in pending["results"]], [str(later.pk)])
        response = _client(self.anna).post(
            self.sharing_url(suffix="review/"),
            {"approve": [str(later.pk)]},
            format="json",
        )
        self.assertEqual(response.json()["pending_count"], 0)
        self.assertIn(str(later.pk), self.mila_photos(self.clara)[1])

    def test_a_declined_photo_stays_back(self):
        self.share([self.clara])
        later = self.label_later()
        _client(self.anna).post(
            self.sharing_url(suffix="review/"),
            {"decline": [str(later.pk)]},
            format="json",
        )
        self.assertNotIn(str(later.pk), self.mila_photos(self.clara)[1])
        self.assertEqual(
            PersonSharePhoto.objects.get(photo=later).status, PersonSharePhoto.DECLINED
        )

    def test_review_reaches_only_the_persons_labelled_photos(self):
        self.share([self.clara])
        foreign = create_test_photo(owner=self.mallory)
        _client(self.anna).post(
            self.sharing_url(suffix="review/"),
            {
                "approve": [
                    str(self.suggested.pk),
                    str(self.rex_only.pk),
                    str(foreign.pk),
                ]
            },
            format="json",
        )
        self.assertFalse(
            PersonSharePhoto.objects.filter(
                photo__in=[self.suggested, self.rex_only, foreign]
            ).exists()
        )

    def test_only_the_owner_reaches_the_sharing_routes(self):
        self.share([self.clara])
        for user in (self.clara, self.mallory):
            for method, suffix, body in (
                ("get", "", None),
                ("put", "", {"recipient_ids": [self.mallory.pk]}),
                ("get", "pending/", None),
                ("post", "review/", {"approve": [str(self.label_later().pk)]}),
            ):
                with self.subTest(user=user.pk, method=method, suffix=suffix):
                    response = getattr(_client(user), method)(
                        self.sharing_url(suffix=suffix), body, format="json"
                    )
                    self.assertEqual(response.status_code, 404)
        self.assertEqual(
            set(PersonShare.objects.values_list("recipient_id", flat=True)),
            {self.clara.pk},
        )

    def test_unnamed_groups_cannot_be_shared(self):
        cluster = create_test_person(
            name="Unknown 012", kind=Person.KIND_CLUSTER, cluster_owner=self.anna
        )
        response = _client(self.anna).put(
            self.sharing_url(cluster), {"recipient_ids": [self.clara.pk]}, format="json"
        )
        self.assertEqual(response.status_code, 404)

    def test_recipients_must_be_other_existing_users(self):
        for ids in ([self.anna.pk], [999999]):
            with self.subTest(ids=ids):
                response = _client(self.anna).put(
                    self.sharing_url(), {"recipient_ids": ids}, format="json"
                )
                self.assertEqual(response.status_code, 400)
        self.assertFalse(PersonShare.objects.exists())


class RevocationTest(PersonSharingBase):
    def assert_gone(self):
        self.assertEqual(self.people(self.clara), [])
        self.assertEqual(
            self.media(self.clara, "thumbnails_big", self.labelled).status_code, 404
        )
        self.assertEqual(
            _client(self.clara).get(f"/api/photos/{self.labelled.pk}/").status_code, 404
        )

    def test_unsharing_ends_access_at_once(self):
        self.share([self.clara])
        self.share([])
        self.assert_gone()

    def test_taking_the_label_off_ends_access(self):
        self.share([self.clara])
        self.face.person = None
        self.face.save()
        self.assert_gone()

    def test_hiding_the_photo_ends_access(self):
        self.share([self.clara])
        Photo.objects.filter(pk=self.labelled.pk).update(hidden=True)
        self.assert_gone()

    def test_a_new_recipient_does_not_unlock_waiting_photos(self):
        """Adding a recipient later approves nothing: photos labelled after
        the first share still wait for the owner."""
        self.share([self.clara])
        later = self.label_later()
        self.assertNotIn(str(later.pk), self.mila_photos(self.clara)[1])
        self.share([self.clara, self.mallory])
        self.assertNotIn(str(later.pk), self.mila_photos(self.mallory)[1])
