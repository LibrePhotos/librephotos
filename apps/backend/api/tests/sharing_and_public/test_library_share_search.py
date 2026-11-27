"""Search follows the library share's rules (#2731).

With Location off a place name must not find the owner's photos, with
People names off a person's name must not, with Captions off a caption or
OCR text must not, with Camera off a camera must not. What the photo shows
(its things) is always found, and file names, keywords and tags never are.
"""

from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import Photo
from api.search.ranked import ranked_photo_ids
from api.search.semantic import TAG_THING_TYPE
from api.sharing.library_search import library_search
from api.tests.utils import (
    create_test_album_thing,
    create_test_face,
    create_test_library_share,
    create_test_person,
    create_test_photo,
    create_test_photo_ocr,
    create_test_tag,
    create_test_user,
)


def search_by_meaning(test, scores):
    def search(user_id, embedding, count, threshold):
        return scores.get(user_id, [])

    embed = patch(
        "api.search.ranked.calculate_query_embeddings",
        return_value=([0.1] * 512, 1.0),
    )
    rank = patch("api.search.ranked.search_ranked_embedding", side_effect=search)
    for patcher in (embed, rank):
        test.addCleanup(patcher.stop)
    embed.start()
    return rank.start()


def found(user, term, **params):
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/photos/searchlist/", {"search": term, **params})
    assert response.status_code == 200, response.content[:300]
    return {item["image_hash"] for item in response.json()["results"]}


class LibrarySearchTest(TestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.recipient = create_test_user()
        self.photo = create_test_photo(
            owner=self.owner,
            search_location="Starnberg Bavaria",
            search_captions="birthday cake Clara SecretCam /photos/holiday-folder",
            captions_json={"user_caption": "birthday cake"},
            camera_make="Secretmaker",
            camera_model="SecretCam",
        )
        create_test_photo_ocr(self.photo, text="Invoice 4711")
        person = create_test_person(name="Clara Ruiz", cluster_owner=self.owner)
        create_test_face(photo=self.photo, person=person)
        thing = create_test_album_thing(
            owner=self.owner, title="tram", thing_type=TAG_THING_TYPE
        )
        thing.photos.add(self.photo)
        create_test_tag(owner=self.owner, name="holidaytag").photos.add(self.photo)
        self.share = create_test_library_share(
            owner=self.owner, recipient=self.recipient, show_in_timeline=True
        )
        self.hash = self.photo.image_hash
        self.scores = {}
        self.search_ranked_embedding = search_by_meaning(self, self.scores)

    def switch(self, **switches):
        for name, value in switches.items():
            setattr(self.share, name, value)
        self.share.save()

    def test_with_every_switch_off_only_what_the_photo_shows_finds_it(self):
        self.assertIn(self.hash, found(self.recipient, "tram"))
        for term in (
            "Starnberg",
            "Clara",
            "birthday",
            "Invoice",
            "SecretCam",
            "Secretmaker",
            "holiday",
            "holidaytag",
        ):
            with self.subTest(term=term):
                self.assertNotIn(self.hash, found(self.recipient, term))

    def test_each_switch_makes_its_terms_findable(self):
        for switch, term in (
            ("share_location", "Starnberg"),
            ("share_faces", "Clara"),
            ("share_captions", "birthday"),
            ("share_captions", "Invoice"),
            ("share_camera_info", "SecretCam"),
        ):
            with self.subTest(switch=switch, term=term):
                self.assertNotIn(self.hash, found(self.recipient, term))
                self.switch(**{switch: True})
                self.assertIn(self.hash, found(self.recipient, term))
                self.switch(**{switch: False})

    def test_file_names_and_tags_are_never_findable(self):
        self.switch(
            share_location=True,
            share_faces=True,
            share_captions=True,
            share_camera_info=True,
            share_originals=True,
        )
        for term in ("holiday-folder", "holidaytag"):
            with self.subTest(term=term):
                self.assertNotIn(self.hash, found(self.recipient, term))

    def test_the_results_hide_what_is_not_shared(self):
        client = APIClient()
        client.force_authenticate(user=self.recipient)
        body = client.get("/api/photos/searchlist/", {"search": "tram"}).content
        self.assertNotIn(b"Starnberg", body)

    def test_only_libraries_in_the_timeline_are_searched(self):
        self.switch(show_in_timeline=False)
        self.assertNotIn(self.hash, found(self.recipient, "tram"))

    def test_a_structured_filter_finds_no_shared_photo(self):
        self.switch(share_camera_info=True)
        self.assertNotIn(self.hash, found(self.recipient, "tram", camera="SecretCam"))
        self.assertNotIn(self.hash, found(self.recipient, "tram", rating_min=1))

    def test_a_stranger_finds_nothing(self):
        stranger = create_test_user()
        self.assertEqual(found(stranger, "tram"), set())

    def test_after_leaving_nothing_is_found(self):
        self.share.delete()
        self.assertEqual(found(self.recipient, "tram"), set())


class LibraryMeaningSearchTest(TestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.recipient = create_test_user()
        self.share = create_test_library_share(
            owner=self.owner, recipient=self.recipient, show_in_timeline=True
        )
        self.scores = {}
        self.search_ranked_embedding = search_by_meaning(self, self.scores)
        self.sunset = create_test_photo(owner=self.owner)
        self.own = create_test_photo(owner=self.recipient)

    def test_a_share_without_a_grant_finds_by_meaning(self):
        self.scores[self.owner.id] = [(self.sunset.image_hash, 0.4)]
        self.assertIn(self.sunset.image_hash, found(self.recipient, "sunset"))

    def test_own_and_shared_photos_are_ranked_together(self):
        self.scores[self.recipient.id] = [(self.own.image_hash, 0.2)]
        self.scores[self.owner.id] = [(self.sunset.image_hash, 0.4)]
        client = APIClient()
        client.force_authenticate(user=self.recipient)
        results = client.get("/api/photos/searchlist/", {"search": "sunset"}).json()
        hashes = [item["image_hash"] for item in results["results"]]
        self.assertEqual(hashes, [self.sunset.image_hash, self.own.image_hash])

    def test_weak_shared_matches_are_left_out(self):
        self.scores[self.owner.id] = [(self.sunset.image_hash, 0.05)]
        self.assertNotIn(self.sunset.image_hash, found(self.recipient, "sunset"))

    def test_hidden_trashed_and_removed_photos_never_show(self):
        hidden = create_test_photo(owner=self.owner, hidden=True)
        trashed = create_test_photo(owner=self.owner, in_trashcan=True)
        removed = create_test_photo(owner=self.owner, removed=True)
        gone = [hidden.image_hash, trashed.image_hash, removed.image_hash]
        self.scores[self.owner.id] = [(image_hash, 1.0) for image_hash in gone]
        self.assertEqual(found(self.recipient, "sunset") & set(gone), set())

    def test_another_users_unshared_photo_never_shows(self):
        stranger = create_test_user()
        secret = create_test_photo(owner=stranger)
        perfect = [(secret.image_hash, 1.0)]
        self.scores.update({stranger.id: perfect, self.owner.id: perfect})
        self.scores[self.recipient.id] = perfect
        self.assertNotIn(secret.image_hash, found(self.recipient, "sunset"))
        searched = {
            call.args[0] for call in self.search_ranked_embedding.call_args_list
        }
        self.assertNotIn(stranger.id, searched)

    def test_only_libraries_in_the_timeline_are_searched_by_meaning(self):
        self.share.show_in_timeline = False
        self.share.save()
        self.scores[self.owner.id] = [(self.sunset.image_hash, 0.9)]
        self.assertNotIn(self.sunset.image_hash, found(self.recipient, "sunset"))
        searched = {
            call.args[0] for call in self.search_ranked_embedding.call_args_list
        }
        self.assertNotIn(self.owner.id, searched)

    def test_a_structured_filter_finds_no_shared_photo_by_meaning(self):
        self.scores[self.owner.id] = [(self.sunset.image_hash, 0.9)]
        self.assertNotIn(
            self.sunset.image_hash, found(self.recipient, "sunset", rating_min=1)
        )

    def test_the_media_filter_applies_to_shared_matches(self):
        self.scores[self.owner.id] = [(self.sunset.image_hash, 0.9)]
        self.assertNotIn(
            self.sunset.image_hash, found(self.recipient, "sunset", video="true")
        )

    def test_the_owner_does_not_find_the_recipients_photos(self):
        self.scores[self.recipient.id] = [(self.own.image_hash, 0.9)]
        self.scores[self.owner.id] = [(self.own.image_hash, 0.9)]
        self.assertNotIn(self.own.image_hash, found(self.owner, "sunset"))

    def test_the_ranking_holds_only_photos_the_share_shows(self):
        hidden = create_test_photo(owner=self.owner, hidden=True)
        secret = create_test_photo(owner=create_test_user())
        self.scores[self.owner.id] = [
            (hidden.image_hash, 1.0),
            (secret.image_hash, 1.0),
            (self.sunset.image_hash, 0.5),
        ]
        libraries = library_search(self.recipient, ["sunset"], [], False)
        own = Photo.visible.owned_by(self.recipient)
        ranked = ranked_photo_ids(self.recipient, own, "sunset", libraries=libraries)
        self.assertEqual(ranked, [self.sunset.pk])
