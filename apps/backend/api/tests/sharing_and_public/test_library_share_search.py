"""Search follows the library share's rules (#2731).

With Location off a place name must not find the owner's photos, with
People names off a person's name must not, with Captions off a caption or
OCR text must not, with Camera off a camera must not. What the photo shows
(its things) is always found, and file names, keywords and tags never are.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.search.semantic import TAG_THING_TYPE
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


def found(user, term, **params):
    client = APIClient()
    client.force_authenticate(user=user)
    response = client.get("/api/photos/searchlist/", {"search": term, **params})
    assert response.status_code == 200, response.content[:300]
    return {
        item["image_hash"]
        for group in response.json()["results"]
        for item in group["items"]
    }


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
