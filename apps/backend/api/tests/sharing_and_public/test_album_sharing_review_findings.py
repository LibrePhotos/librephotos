"""Security review findings for the #464/#262/#668 stack (#2845, #2849, #2850).

Each test states the secure behaviour; a failure is the proof.
"""

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import AlbumRole, AlbumUserPhoto
from api.tests.utils import (
    create_test_album_place,
    create_test_album_user,
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


class CeilingBypassThroughSharedWithYouTest(TestCase):
    """F1: the album owner's "What members see" ceiling (members_share_*,
    new in #2845) is applied to the album grid and the photo detail, but not
    to the "Shared with you" places / people lists and their photo lists,
    which are built from ``Photo.shared_with_me`` (the owner's photos of
    every album shared with the viewer)."""

    def setUp(self):
        self.anna = create_test_user()
        self.anna.share_people_names = True
        self.anna.save()
        self.clara = create_test_user()
        self.photo = create_test_photo(
            owner=self.anna,
            search_location="Anna Home Street",
            gps_lat=48.1371,
            gps_lon=11.5754,
        )
        place = create_test_album_place(title="AnnaHomePlace", owner=self.anna)
        place.photos.add(self.photo)
        sofia = create_test_person(name="SofiaChild", cluster_owner=self.anna)
        create_test_face(photo=self.photo, person=sofia)
        self.album = create_test_album_user(owner=self.anna, title="Kids")
        self.album.photos.add(self.photo)
        response = _client(self.anna).post(
            "/api/useralbum/share/",
            {
                "shared": True,
                "target_user_id": self.clara.pk,
                "album_id": self.album.pk,
                "role": AlbumRole.VIEWER,
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        # Anna turns location and people's names off for the album's members.
        response = _client(self.anna).patch(
            f"/api/albums/user/{self.album.pk}/",
            {"members_share_location": False, "members_share_faces": False},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)

    def test_the_grid_and_the_detail_do_honour_the_ceiling(self):
        body = _client(self.clara).get(f"/api/albums/user/{self.album.pk}/").content
        self.assertNotIn(b"48.1371", body)
        self.assertNotIn(b"Anna Home Street", body)
        detail = _client(self.clara).get(f"/api/photos/{self.photo.pk}/").json()
        self.assertIsNone(detail["exif_gps_lat"])
        self.assertEqual(detail["people"], [])

    def test_shared_with_you_places_honour_the_location_ceiling(self):
        places = _client(self.clara).get("/api/photos/shared/tome/places/").content
        self.assertNotIn(b"AnnaHomePlace", places)

    def test_shared_with_you_place_photos_honour_the_location_ceiling(self):
        photos = _client(self.clara).get(
            "/api/photos/shared/tome/places/photos/?title=AnnaHomePlace"
        )
        self.assertNotIn(b"48.1371", photos.content)

    def test_shared_with_you_people_honour_the_faces_ceiling(self):
        people = _client(self.clara).get("/api/photos/shared/tome/people/").content
        self.assertNotIn(b"SofiaChild", people)


class LateAddAfterDemotionTest(TestCase):
    """F3 (low): a link a contributor's add wrote after their demotion (the
    add checks the role, then inserts, outside a transaction) survives the
    demotion's clean-up and silently comes back when they are promoted again.
    Modelled by writing the link while they are a viewer."""

    def test_a_late_link_does_not_revive_on_repromotion(self):
        anna, ben, clara = create_test_user(), create_test_user(), create_test_user()
        album = create_test_album_user(owner=anna)
        photo = create_test_photo(owner=ben)
        for user, role in ((ben, AlbumRole.VIEWER), (clara, AlbumRole.VIEWER)):
            _client(anna).post(
                "/api/useralbum/share/",
                {
                    "shared": True,
                    "target_user_id": user.pk,
                    "album_id": album.pk,
                    "role": role,
                },
                format="json",
            )
        # The add that lost the race with "make Ben a viewer".
        AlbumUserPhoto.objects.create(albumuser=album, photo=photo, added_by=ben)
        _client(anna).post(
            "/api/useralbum/share/",
            {
                "shared": True,
                "target_user_id": ben.pk,
                "album_id": album.pk,
                "role": AlbumRole.CONTRIBUTOR,
            },
            format="json",
        )
        body = _client(clara).get(f"/api/albums/user/{album.pk}/").content
        self.assertNotIn(str(photo.pk).encode(), body)


class PersonReviewQueueBypassTest(TestCase):
    """F4 (low): the "approve everything labelled at first share" rule keys
    on "no share and no decision exists". A person first shared while it had
    no labelled photo leaves no decision behind; photos labelled afterwards
    wait for review, but switching the only recipient off and on again
    approves every one of them without a review."""

    def test_unshare_and_reshare_does_not_approve_waiting_photos(self):
        from api.tests.utils import create_test_face, create_test_person

        anna, clara = create_test_user(), create_test_user()
        mila = create_test_person(name="Mila", cluster_owner=anna)
        url = f"/api/persons/{mila.pk}/sharing/"
        client = _client(anna)
        self.assertEqual(
            client.put(url, {"recipient_ids": [clara.pk]}, format="json").status_code,
            200,
        )
        later = create_test_photo(owner=anna)
        create_test_face(photo=later, person=mila)
        self.assertEqual(client.get(url).json()["pending_count"], 1)
        client.put(url, {"recipient_ids": []}, format="json")
        body = client.put(url, {"recipient_ids": [clara.pk]}, format="json").json()
        self.assertEqual(body["pending_count"], 1, body)
        response = _client(clara).get(f"/api/photos/{later.pk}/")
        self.assertEqual(response.status_code, 404)


class _AlbumSharedWithClara(TestCase):
    """Anna's photo with a place, a thing and a named person, in an album
    she shares with Clara for viewing."""

    def setUp(self):
        from api.search.semantic import TAG_THING_TYPE
        from api.tests.utils import create_test_album_thing

        self.anna = create_test_user()
        self.anna.share_people_names = True
        self.anna.save()
        self.clara = create_test_user()
        self.photo = create_test_photo(
            owner=self.anna, search_location="Anna Garden", gps_lat=47.1, gps_lon=11.1
        )
        thing = create_test_album_thing(
            title="dogthingtitle", thing_type=TAG_THING_TYPE, owner=self.anna
        )
        thing.photos.add(self.photo)
        self.sofia = create_test_person(name="SofiaKid", cluster_owner=self.anna)
        create_test_face(photo=self.photo, person=self.sofia)
        self.album = create_test_album_user(owner=self.anna)
        self.album.photos.add(self.photo)
        _client(self.anna).post(
            "/api/useralbum/share/",
            {
                "shared": True,
                "target_user_id": self.clara.pk,
                "album_id": self.album.pk,
                "role": AlbumRole.VIEWER,
            },
            format="json",
        )

    def members_see(self, **switches):
        response = _client(self.anna).patch(
            f"/api/albums/user/{self.album.pk}/",
            {f"members_share_{name}": on for name, on in switches.items()},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)

    def rows(self, url):
        response = _client(self.clara).get(url)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["results"]


class CeilingInSharedListsTest(_AlbumSharedWithClara):
    """F1, the other lists: things follow the captions switch, and a photo
    reached only through the album shows its rows with the album's ceiling,
    whichever list it is in. A photo shared one by one keeps everything."""

    THING_PHOTOS = "/api/photos/shared/tome/things/photos/?title=dogthingtitle"

    def test_things_follow_the_captions_switch(self):
        self.members_see(captions=False)
        body = _client(self.clara).get("/api/photos/shared/tome/things/").content
        self.assertNotIn(b"dogthingtitle", body)

    def test_a_list_allowed_by_one_switch_still_redacts_the_others(self):
        self.members_see(location=False)
        rows = self.rows(self.THING_PHOTOS)
        self.assertEqual([row["id"] for row in rows], [str(self.photo.pk)])
        self.assertIsNone(rows[0]["exif_gps_lat"])
        self.assertEqual(rows[0]["location"], "")

    def test_a_photo_shared_one_by_one_keeps_what_that_share_shows(self):
        self.members_see(location=False, captions=False)
        self.photo.shared_to.add(self.clara)
        body = _client(self.clara).get("/api/photos/shared/tome/things/").content
        self.assertIn(b"dogthingtitle", body)
        self.assertEqual(self.rows(self.THING_PHOTOS)[0]["exif_gps_lat"], 47.1)


class PersonListThroughAlbumTest(_AlbumSharedWithClara):
    """F1 for the people list (#668): a person's photo Clara reads through
    the album shows what the album allows, not everything."""

    def test_the_album_ceiling_redacts_the_person_photo_rows(self):
        self.members_see(location=False)
        rows = self.rows(
            f"/api/photos/shared/tome/people/photos/?person={self.sofia.pk}"
        )
        self.assertEqual([row["id"] for row in rows], [str(self.photo.pk)])
        self.assertIsNone(rows[0]["exif_gps_lat"])
        self.assertEqual(rows[0]["location"], "")

    def test_names_off_hides_the_person(self):
        self.members_see(faces=False)
        body = _client(self.clara).get("/api/photos/shared/tome/people/").content
        self.assertNotIn(b"SofiaKid", body)
