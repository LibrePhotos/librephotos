"""Album collections (#1009, #871): a user's own grouping of their albums.

CRUD at ``/api/albums/collections/``, membership set from the album's side
(``PUT /api/albums/user/<id>/collections/``), the ``?collection=`` filter of My
Albums and the ``collection_ids`` of an album card, which only its owner sees.
"""

import datetime

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework.test import APIClient

from api.models import AlbumCollection, AlbumUser
from api.tests.infra.test_declared_responses import DeclaredResponseTestCase
from api.tests.utils import (
    create_test_album_collection,
    create_test_album_user,
    create_test_photo,
    create_test_user,
)

COLLECTIONS = "/api/albums/collections/"


def _album_with_photo(owner, title=None):
    """An album My Albums lists: it has a visible photo."""
    album = create_test_album_user(owner=owner, title=title)
    album.photos.add(create_test_photo(owner=owner))
    return album


class CollectionTestCase(DeclaredResponseTestCase):
    def setUp(self):
        self.user = create_test_user()
        self.other = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(self.user)


class CollectionCrudTest(CollectionTestCase):
    def test_lists_only_the_requesters_collections_by_name(self):
        create_test_album_collection(owner=self.user, name="Travel")
        create_test_album_collection(owner=self.user, name="Family")
        create_test_album_collection(owner=self.other, name="Theirs")

        body = self.assert_declared(COLLECTIONS, COLLECTIONS)

        self.assertEqual([row["name"] for row in body["results"]], ["Family", "Travel"])

    def test_create_trims_the_name_and_sets_the_owner(self):
        response = self.client.post(COLLECTIONS, {"name": "  Travel "}, format="json")

        self.assertEqual(response.status_code, 201, response.content)
        collection = AlbumCollection.objects.get(pk=response.json()["id"])
        self.assertEqual(collection.name, "Travel")
        self.assertEqual(collection.owner, self.user)
        self.assertEqual(response.json(), {"id": collection.pk, "name": "Travel"})

    def test_a_name_in_use_in_any_letter_case_is_refused(self):
        create_test_album_collection(owner=self.user, name="Travel")

        response = self.client.post(COLLECTIONS, {"name": "travel"}, format="json")

        self.assertEqual(response.status_code, 400)
        (error,) = response.json()["errors"]
        self.assertEqual((error["field"], error["code"]), ("name", "unique"))

    def test_another_users_name_is_free(self):
        create_test_album_collection(owner=self.other, name="Travel")

        response = self.client.post(COLLECTIONS, {"name": "Travel"}, format="json")

        self.assertEqual(response.status_code, 201)

    def test_a_blank_name_is_refused(self):
        response = self.client.post(COLLECTIONS, {"name": "   "}, format="json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["errors"][0]["field"], "name")

    def test_rename(self):
        collection = create_test_album_collection(owner=self.user, name="Travel")

        response = self.client.patch(
            f"{COLLECTIONS}{collection.pk}/", {"name": "Trips"}, format="json"
        )

        self.assertEqual(response.status_code, 200)
        collection.refresh_from_db()
        self.assertEqual(collection.name, "Trips")

    def test_a_new_spelling_of_its_own_name_is_not_a_clash(self):
        collection = create_test_album_collection(owner=self.user, name="travel")

        response = self.client.patch(
            f"{COLLECTIONS}{collection.pk}/", {"name": "Travel"}, format="json"
        )

        self.assertEqual(response.status_code, 200)

    def test_renaming_onto_another_collection_is_refused(self):
        create_test_album_collection(owner=self.user, name="Travel")
        collection = create_test_album_collection(owner=self.user, name="Family")

        response = self.client.patch(
            f"{COLLECTIONS}{collection.pk}/", {"name": "TRAVEL"}, format="json"
        )

        self.assertEqual(response.status_code, 400)

    def test_delete_keeps_the_albums(self):
        album = _album_with_photo(self.user)
        collection = create_test_album_collection(owner=self.user, albums=[album])

        response = self.client.delete(f"{COLLECTIONS}{collection.pk}/")

        self.assertEqual(response.status_code, 204)
        self.assertFalse(AlbumCollection.objects.filter(pk=collection.pk).exists())
        self.assertTrue(AlbumUser.objects.filter(pk=album.pk).exists())

    def test_another_users_collection_is_not_found(self):
        theirs = create_test_album_collection(owner=self.other, name="Theirs")
        url = f"{COLLECTIONS}{theirs.pk}/"

        self.assertEqual(
            self.client.patch(url, {"name": "x"}, format="json").status_code, 404
        )
        self.assertEqual(self.client.delete(url).status_code, 404)
        theirs.refresh_from_db()
        self.assertEqual(theirs.name, "Theirs")

    def test_an_anonymous_caller_is_refused(self):
        self.assertEqual(APIClient().get(COLLECTIONS).status_code, 401)

    def test_the_database_refuses_a_name_in_another_letter_case(self):
        create_test_album_collection(owner=self.user, name="Travel")
        with self.assertRaises(IntegrityError), transaction.atomic():
            AlbumCollection.objects.create(
                owner=self.user, name="TRAVEL"
            )  # raw-create: the constraint itself

    def test_a_deleted_user_takes_their_collections_along(self):
        album = _album_with_photo(self.user)
        collection = create_test_album_collection(owner=self.user, albums=[album])

        self.user.delete()

        self.assertFalse(AlbumCollection.objects.filter(pk=collection.pk).exists())
        self.assertTrue(AlbumUser.objects.filter(pk=album.pk).exists())


class SetAlbumCollectionsTest(CollectionTestCase):
    def setUp(self):
        super().setUp()
        self.album = _album_with_photo(self.user)
        self.url = f"/api/albums/user/{self.album.pk}/collections/"
        self.travel = create_test_album_collection(owner=self.user, name="Travel")
        self.family = create_test_album_collection(owner=self.user, name="Family")

    def _put(self, ids, url=None):
        return self.client.put(url or self.url, {"collection_ids": ids}, format="json")

    def test_sets_exactly_the_listed_collections(self):
        self.travel.albums.add(self.album)

        body = self.assert_declared(
            "/api/albums/user/{id}/collections/",
            self.url,
            method="put",
            data={"collection_ids": [self.family.pk]},
        )

        self.assertEqual(body, {"collection_ids": [self.family.pk]})
        self.assertEqual(list(self.album.collections.all()), [self.family])

    def test_an_empty_list_takes_the_album_out_of_every_collection(self):
        self.travel.albums.add(self.album)

        response = self._put([])

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"collection_ids": []})
        self.assertFalse(self.album.collections.exists())

    def test_only_the_changed_collections_get_a_new_last_modified(self):
        long_ago = timezone.now() - datetime.timedelta(days=1)
        self.travel.albums.add(self.album)
        AlbumCollection.objects.update(last_modified=long_ago)

        self._put([self.travel.pk, self.family.pk])

        self.travel.refresh_from_db()
        self.family.refresh_from_db()
        self.assertEqual(self.travel.last_modified, long_ago)
        self.assertGreater(self.family.last_modified, long_ago)

    def test_another_users_collection_is_refused(self):
        theirs = create_test_album_collection(owner=self.other)

        response = self._put([self.travel.pk, theirs.pk])

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["errors"][0]["field"], "collection_ids")
        self.assertFalse(self.album.collections.exists())
        self.assertFalse(theirs.albums.exists())

    def test_another_users_album_is_not_found(self):
        theirs = _album_with_photo(self.other)

        response = self._put(
            [self.travel.pk], url=f"/api/albums/user/{theirs.pk}/collections/"
        )

        self.assertEqual(response.status_code, 404)
        self.assertFalse(self.travel.albums.exists())

    def test_an_album_shared_with_the_requester_is_not_theirs_to_file(self):
        shared = _album_with_photo(self.other)
        shared.shared_to.add(self.user)

        response = self._put(
            [self.travel.pk], url=f"/api/albums/user/{shared.pk}/collections/"
        )

        self.assertEqual(response.status_code, 404)
        self.assertFalse(self.travel.albums.exists())

    def test_a_missing_list_is_refused(self):
        response = self.client.put(self.url, {}, format="json")

        self.assertEqual(response.status_code, 400)


class AlbumListCollectionsTest(CollectionTestCase):
    def setUp(self):
        super().setUp()
        self.porto = _album_with_photo(self.user, title="Porto")
        self.paris = _album_with_photo(self.user, title="Paris")
        self.travel = create_test_album_collection(
            owner=self.user, name="Travel", albums=[self.porto]
        )

    def _titles(self, url):
        response = self.client.get(url)
        self.assertEqual(response.status_code, 200, response.content)
        return [album["title"] for album in response.json()["results"]]

    def test_the_cards_carry_their_collection_ids(self):
        family = create_test_album_collection(
            owner=self.user, name="Family", albums=[self.porto]
        )

        results = self.client.get("/api/albums/user/list/").json()["results"]

        by_title = {album["title"]: album["collection_ids"] for album in results}
        self.assertEqual(
            by_title, {"Porto": sorted([self.travel.pk, family.pk]), "Paris": []}
        )

    def test_the_collection_filter(self):
        self.assertEqual(
            self._titles(f"/api/albums/user/list/?collection={self.travel.pk}"),
            ["Porto"],
        )

    def test_another_users_collection_filters_to_nothing(self):
        theirs_album = _album_with_photo(self.other)
        theirs = create_test_album_collection(owner=self.other, albums=[theirs_album])

        self.assertEqual(
            self._titles(f"/api/albums/user/list/?collection={theirs.pk}"), []
        )

    def test_a_malformed_collection_is_a_400(self):
        response = self.client.get("/api/albums/user/list/?collection=travel")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["errors"][0]["field"], "collection")

    def test_the_people_an_album_is_shared_with_do_not_see_its_collections(self):
        self.porto.shared_to.add(self.other)
        client = APIClient()
        client.force_authenticate(self.other)

        (card,) = client.get("/api/albums/user/shared/tome/").json()["results"]
        photo = self.porto.photos.get()
        (photo_card,) = client.get(f"/api/photos/{photo.pk}/albums/").json()["results"]

        self.assertEqual(card["collection_ids"], [])
        self.assertEqual(photo_card["collection_ids"], [])

    def test_the_owner_sees_them_on_every_card(self):
        self.porto.shared_to.add(self.other)
        photo = self.porto.photos.get()

        (fromme,) = self.client.get("/api/albums/user/shared/fromme/").json()["results"]
        (photo_card,) = self.client.get(f"/api/photos/{photo.pk}/albums/").json()[
            "results"
        ]
        share = self.client.post(
            "/api/useralbum/share/",
            {
                "shared": False,
                "target_user_id": self.other.pk,
                "album_id": self.porto.pk,
            },
            format="json",
        ).json()

        for card in (fromme, photo_card, share):
            self.assertEqual(card["collection_ids"], [self.travel.pk])

    def test_the_album_page_carries_them_for_the_owner_only(self):
        self.porto.shared_to.add(self.other)
        url = f"/api/albums/user/{self.porto.pk}/"
        client = APIClient()
        client.force_authenticate(self.other)

        self.assertEqual(
            self.client.get(url).json()["collection_ids"], [self.travel.pk]
        )
        self.assertEqual(client.get(url).json()["collection_ids"], [])
