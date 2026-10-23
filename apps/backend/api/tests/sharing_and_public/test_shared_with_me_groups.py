"""Sharing > Shared with you: places, things and people (#2721, #2722).

Each list is built from the photos other users shared with the requester and
nothing else: counts and covers never include the owner's other photos, a
person shows only when the owner named them and lets recipients see names.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import Photo
from api.models.photo import trash_photos
from api.tests.utils import (
    create_test_album_place,
    create_test_album_thing,
    create_test_album_user,
    create_test_face,
    create_test_person,
    create_test_photo,
    create_test_user,
)

TAG_TYPE = "openclip_vitb32_tag"
PLACES = "/api/photos/shared/tome/places/"
PLACE_PHOTOS = "/api/photos/shared/tome/places/photos/"
THINGS = "/api/photos/shared/tome/things/"
THING_PHOTOS = "/api/photos/shared/tome/things/photos/"
PEOPLE = "/api/photos/shared/tome/people/"
PERSON_PHOTOS = "/api/photos/shared/tome/people/photos/"


def client_for(user):
    client = APIClient()
    if user is not None:
        client.force_authenticate(user=user)
    return client


def hashes(payload):
    return sorted(photo["image_hash"] for photo in payload["results"])


class SharedPlacesAndThingsTest(TestCase):
    def setUp(self):
        self.alice = create_test_user()
        self.bob = create_test_user()
        self.carol = create_test_user()
        self.shared = create_test_photo(owner=self.alice)
        self.private = create_test_photo(owner=self.alice)
        self.shared.shared_to.add(self.bob)
        self.lisbon = create_test_album_place(owner=self.alice, title="Lisbon")
        self.lisbon.photos.add(self.shared, self.private)
        self.tram = create_test_album_thing(
            owner=self.alice, title="tram", thing_type=TAG_TYPE
        )
        self.tram.photos.add(self.shared, self.private)

    def get(self, user, url, **params):
        return client_for(user).get(url, params)

    def test_the_recipient_sees_only_the_shared_photo_of_a_place(self):
        body = self.get(self.bob, PLACES).json()

        [entry] = body["results"]
        self.assertEqual(entry["title"], "Lisbon")
        self.assertEqual(entry["photo_count"], 1)
        self.assertEqual(
            entry["cover_photos"],
            [{"image_hash": self.shared.image_hash, "video": False}],
        )

    def test_the_recipient_sees_only_the_shared_photo_of_a_thing(self):
        [entry] = self.get(self.bob, THINGS).json()["results"]

        self.assertEqual((entry["title"], entry["photo_count"]), ("tram", 1))
        self.assertNotIn(self.private.image_hash, str(entry))

    def test_the_detail_lists_only_the_shared_photos(self):
        for url in (PLACE_PHOTOS, THING_PHOTOS):
            title = "Lisbon" if url == PLACE_PHOTOS else "tram"
            with self.subTest(url=url):
                response = self.get(self.bob, url, title=title)
                self.assertEqual(response.status_code, 200, response.content)
                self.assertEqual(hashes(response.json()), [self.shared.image_hash])

    def test_a_title_without_shared_photos_is_a_404(self):
        for url in (PLACE_PHOTOS, THING_PHOTOS):
            with self.subTest(url=url):
                self.assertEqual(
                    self.get(self.bob, url, title="Porto").status_code, 404
                )
                self.assertEqual(
                    self.get(self.carol, url, title="Lisbon").status_code, 404
                )

    def test_the_detail_needs_a_title(self):
        self.assertEqual(self.get(self.bob, PLACE_PHOTOS).status_code, 400)

    def test_someone_nothing_was_shared_with_sees_nothing(self):
        for url in (PLACES, THINGS):
            with self.subTest(url=url):
                self.assertEqual(self.get(self.carol, url).json()["results"], [])

    def test_the_owner_does_not_see_their_own_photos_here(self):
        for url in (PLACES, THINGS):
            with self.subTest(url=url):
                self.assertEqual(self.get(self.alice, url).json()["results"], [])

    def test_the_recipients_own_places_page_does_not_change(self):
        body = self.get(self.bob, "/api/albums/place/list/").json()

        self.assertEqual(body["results"], [])

    def test_anonymous_callers_are_refused(self):
        for url in (PLACES, THINGS, PLACE_PHOTOS, THING_PHOTOS, PEOPLE, PERSON_PHOTOS):
            with self.subTest(url=url):
                self.assertIn(self.get(None, url).status_code, (401, 403))

    def test_an_album_share_counts_too(self):
        album_photo = create_test_photo(owner=self.alice)
        self.lisbon.photos.add(album_photo)
        album = create_test_album_user(owner=self.alice)
        album.photos.add(album_photo, self.shared)
        album.shared_to.add(self.bob)

        [entry] = self.get(self.bob, PLACES).json()["results"]

        # The photo shared both ways counts once.
        self.assertEqual(entry["photo_count"], 2)

    def test_hidden_trashed_and_removed_photos_are_left_out(self):
        for field in ("hidden", "removed"):
            photo = create_test_photo(owner=self.alice, **{field: True})
            photo.shared_to.add(self.bob)
            self.lisbon.photos.add(photo)
        trashed = create_test_photo(owner=self.alice)
        trashed.shared_to.add(self.bob)
        self.lisbon.photos.add(trashed)
        trash_photos(Photo.objects.filter(pk=trashed.pk))

        [entry] = self.get(self.bob, PLACES).json()["results"]

        self.assertEqual(entry["photo_count"], 1)

    def test_unsharing_takes_the_place_away(self):
        self.shared.shared_to.remove(self.bob)

        self.assertEqual(self.get(self.bob, PLACES).json()["results"], [])
        self.assertEqual(
            self.get(self.bob, PLACE_PHOTOS, title="Lisbon").status_code, 404
        )

    def test_other_users_public_photos_are_left_out(self):
        public = create_test_photo(owner=self.carol, public=True)
        create_test_album_place(owner=self.carol, title="Porto").photos.add(public)

        titles = [e["title"] for e in self.get(self.bob, PLACES).json()["results"]]

        self.assertEqual(titles, ["Lisbon"])

    def test_two_owners_places_of_one_name_are_one_entry(self):
        dave = create_test_user()
        photo = create_test_photo(owner=dave)
        photo.shared_to.add(self.bob)
        create_test_album_place(owner=dave, title="Lisbon").photos.add(photo)

        [entry] = self.get(self.bob, PLACES).json()["results"]

        self.assertEqual(entry["photo_count"], 2)
        self.assertEqual(len(entry["cover_photos"]), 2)
        detail = self.get(self.bob, PLACE_PHOTOS, title="Lisbon").json()
        self.assertEqual(
            hashes(detail), sorted([self.shared.image_hash, photo.image_hash])
        )

    def test_covers_stop_at_four(self):
        for _ in range(5):
            photo = create_test_photo(owner=self.alice)
            photo.shared_to.add(self.bob)
            self.lisbon.photos.add(photo)

        [entry] = self.get(self.bob, PLACES).json()["results"]

        self.assertEqual(entry["photo_count"], 6)
        self.assertEqual(len(entry["cover_photos"]), 4)

    def test_things_of_other_types_are_left_out(self):
        create_test_album_thing(
            owner=self.alice, title="old-model", thing_type="places365_attribute"
        ).photos.add(self.shared)
        create_test_album_thing(
            owner=self.alice, title="trip", thing_type="hashtag_attribute"
        ).photos.add(self.shared)

        titles = [e["title"] for e in self.get(self.bob, THINGS).json()["results"]]

        self.assertEqual(titles, ["tram", "trip"])
        self.assertEqual(
            self.get(self.bob, THING_PHOTOS, title="old-model").status_code, 404
        )


class SharedPeopleTest(TestCase):
    def setUp(self):
        self.alice = create_test_user(share_people_names=True)
        self.bob = create_test_user()
        self.carol = create_test_user()
        self.shared = create_test_photo(owner=self.alice)
        self.private = create_test_photo(owner=self.alice)
        self.shared.shared_to.add(self.bob)
        self.mom = create_test_person(name="Mom", cluster_owner=self.alice)
        self.shared_face = create_test_face(
            photo=self.shared, person=self.mom, image="faces/shared.jpg"
        )
        # Lower id than the shared face: never the crop the recipient gets.
        create_test_face(photo=self.private, person=self.mom, image="faces/private.jpg")

    def people(self, user):
        return client_for(user).get(PEOPLE).json()["results"]

    def photos_of(self, user, person):
        return client_for(user).get(PERSON_PHOTOS, {"person": person.pk})

    def test_the_recipient_sees_the_named_person_with_the_shared_photo_only(self):
        [entry] = self.people(self.bob)

        self.assertEqual(entry["id"], self.mom.pk)
        self.assertEqual(entry["name"], "Mom")
        self.assertEqual(entry["owner"]["id"], self.alice.pk)
        self.assertEqual(entry["photo_count"], 1)
        self.assertTrue(entry["face_url"].endswith("faces/shared.jpg"))
        self.assertEqual(set(entry), {"id", "name", "owner", "photo_count", "face_url"})
        response = self.photos_of(self.bob, self.mom)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(hashes(response.json()), [self.shared.image_hash])

    def test_nobody_else_sees_the_person(self):
        self.assertEqual(self.people(self.carol), [])
        self.assertEqual(self.photos_of(self.carol, self.mom).status_code, 404)
        # The owner's own photos are not "shared with" them.
        self.assertEqual(self.people(self.alice), [])

    def test_names_stay_back_while_the_owner_does_not_share_them(self):
        self.alice.share_people_names = False
        self.alice.save()

        self.assertEqual(self.people(self.bob), [])
        self.assertEqual(self.photos_of(self.bob, self.mom).status_code, 404)

    def test_unnamed_clustered_and_deleted_faces_are_not_listed(self):
        cluster = create_test_person(
            name="Unknown 012", kind="CLUSTER", cluster_owner=self.alice
        )
        unknown = create_test_person(
            name="Unknown - Other", kind="UNKNOWN", cluster_owner=self.alice
        )
        ghost = create_test_person(name="Ghost", cluster_owner=self.alice)
        create_test_face(photo=self.shared, person=None, cluster_person=cluster)
        create_test_face(photo=self.shared, person=unknown)
        create_test_face(photo=self.shared, person=ghost, deleted=True)
        create_test_face(photo=self.shared, person=None, classification_person=ghost)

        self.assertEqual([p["name"] for p in self.people(self.bob)], ["Mom"])
        self.assertEqual(self.photos_of(self.bob, cluster).status_code, 404)
        self.assertEqual(self.photos_of(self.bob, ghost).status_code, 404)

    def test_two_owners_people_of_one_name_stay_apart(self):
        dave = create_test_user(share_people_names=True)
        photo = create_test_photo(owner=dave)
        photo.shared_to.add(self.bob)
        daves_mom = create_test_person(name="Mom", cluster_owner=dave)
        create_test_face(photo=photo, person=daves_mom)

        people = self.people(self.bob)

        self.assertEqual(
            sorted((p["id"], p["owner"]["id"]) for p in people),
            sorted([(self.mom.pk, self.alice.pk), (daves_mom.pk, dave.pk)]),
        )

    def test_unsharing_the_last_photo_removes_the_person(self):
        self.shared.shared_to.remove(self.bob)

        self.assertEqual(self.people(self.bob), [])
        self.assertEqual(self.photos_of(self.bob, self.mom).status_code, 404)

    def test_an_album_share_shows_the_person_too(self):
        album = create_test_album_user(owner=self.alice)
        album.photos.add(self.private)
        album.shared_to.add(self.carol)

        [entry] = self.people(self.carol)

        self.assertEqual(entry["photo_count"], 1)
        self.assertTrue(entry["face_url"].endswith("faces/private.jpg"))

    def test_a_face_without_a_crop_gives_no_url(self):
        self.shared_face.image = None
        self.shared_face.save()

        [entry] = self.people(self.bob)

        self.assertIsNone(entry["face_url"])

    def test_the_person_must_be_the_photo_owners(self):
        # A face labelled with someone else's person never lists that person.
        strangers = create_test_person(name="Stranger", cluster_owner=self.carol)
        create_test_face(photo=self.shared, person=strangers)

        self.assertEqual([p["name"] for p in self.people(self.bob)], ["Mom"])


class PhotoDetailPeopleTest(TestCase):
    """The people of ``GET /api/photos/<id>/`` follow the same rule."""

    def setUp(self):
        self.alice = create_test_user()
        self.bob = create_test_user()
        self.photo = create_test_photo(owner=self.alice)
        self.photo.shared_to.add(self.bob)
        mom = create_test_person(name="Mom", cluster_owner=self.alice)
        cluster = create_test_person(
            name="Unknown 012", kind="CLUSTER", cluster_owner=self.alice
        )
        suggestion = create_test_person(name="Maybe Ben", cluster_owner=self.alice)
        create_test_face(photo=self.photo, person=mom)
        create_test_face(photo=self.photo, person=None, cluster_person=cluster)
        create_test_face(
            photo=self.photo, person=None, classification_person=suggestion
        )

    def names(self, user, photo=None):
        photo = photo or self.photo
        response = client_for(user).get(f"/api/photos/{photo.pk}/")
        self.assertEqual(response.status_code, 200, response.content[:300])
        return [person["name"] for person in response.json()["people"]]

    def test_the_owner_sees_every_face(self):
        self.assertEqual(self.names(self.alice), ["Mom", "Unknown 012", "Maybe Ben"])

    def test_a_recipient_sees_nobody_while_names_are_not_shared(self):
        self.assertEqual(self.names(self.bob), [])

    def test_a_recipient_sees_only_named_people_once_names_are_shared(self):
        self.alice.share_people_names = True
        self.alice.save()

        self.assertEqual(self.names(self.bob), ["Mom"])

    def test_a_public_photo_follows_the_public_share_faces_default(self):
        self.photo.public = True
        self.photo.save()
        # Names shared with recipients do not reach public visitors.
        self.alice.share_people_names = True
        self.alice.save()
        stranger = create_test_user()
        self.assertEqual(self.names(None), [])
        self.assertEqual(self.names(stranger), [])

        self.alice.public_sharing_defaults = {"share_faces": True}
        self.alice.save()

        self.assertEqual(self.names(None), ["Mom"])
        self.assertEqual(self.names(stranger), ["Mom"])


class PublicPhotoPeopleTest(TestCase):
    """A public album or photo link shows only named people too."""

    def test_a_cluster_is_not_shown_on_a_photo_link(self):
        from api.serializers.photos import PublicPhotoDetailSerializer

        owner = create_test_user()
        photo = create_test_photo(owner=owner)
        create_test_face(
            photo=photo,
            person=None,
            cluster_person=create_test_person(name="Unknown 3", kind="CLUSTER"),
        )
        create_test_face(photo=photo, person=create_test_person(name="Anna"))

        people = PublicPhotoDetailSerializer(
            photo, context={"sharing_settings": {"share_faces": True}}
        ).data["people"]

        self.assertEqual([p["name"] for p in people], ["Anna"])


class SharePeopleNamesSettingTest(TestCase):
    def test_it_is_off_by_default_and_the_user_can_turn_it_on(self):
        user = create_test_user()
        client = client_for(user)
        self.assertFalse(
            client.get(f"/api/user/{user.pk}/").json()["share_people_names"]
        )

        response = client.patch(
            f"/api/user/{user.pk}/", {"share_people_names": True}, format="json"
        )

        self.assertEqual(response.status_code, 200, response.content[:300])
        user.refresh_from_db()
        self.assertTrue(user.share_people_names)
