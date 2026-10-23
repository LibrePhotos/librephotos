"""Collaborative albums (#464), adversarially.

Anna owns the album, Ben contributes his own photos, Clara only views,
Mallory is nobody in it. The rule under test widens GHSA-phvg-g65q-rhq3 ("an
album only vouches for its owner's photos") to photos a *current*
contributor added from their own library, and to nothing else:

* every read path (media, photo detail, album detail, the photo's albums)
  shows Ben's photo to members only, and stops the moment Ben stops being a
  contributor, even if the link row were left behind;
* what members see of Ben's photo is what both Anna's ceiling and Ben's own
  switches allow ("both must allow"), never the fields that are never shared;
* a public link, search, the timeline, zips and the "Shared with you" lists
  never carry a contributor's photo;
* nobody adds a photo that is not theirs, removes one they did not add, or
  writes to an album they are not in.
"""

import uuid

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import AlbumRole, AlbumUserMember, AlbumUserPhoto, Photo
from api.models.album_user_share import AlbumUserShare
from api.models.user import get_default_public_sharing_settings
from api.sharing.copies import COPIES_DIR
from api.tests.utils import (
    create_test_album_place,
    create_test_album_user,
    create_test_face,
    create_test_library_share,
    create_test_person,
    create_test_photo,
    create_test_user,
)


def _client(user):
    client = APIClient()
    if user is not None:
        client.force_authenticate(user=user)
    return client


class CollaborativeAlbumBase(TestCase):
    def setUp(self):
        self.anna = create_test_user()
        self.ben = create_test_user()
        self.clara = create_test_user()
        self.mallory = create_test_user()
        self.anna_photo = create_test_photo(
            owner=self.anna, search_location="Anna's Garden", gps_lat=48.1, gps_lon=11.5
        )
        self.ben_photo = create_test_photo(
            owner=self.ben,
            search_location="Ben's Street",
            gps_lat=52.5,
            gps_lon=13.4,
            camera="BenCam",
            captions_json={"user_caption": "ben caption"},
            search_captions="ben searchable caption",
        )
        self.ben_other = create_test_photo(owner=self.ben)
        self.album = create_test_album_user(title="Bruno and Mila", owner=self.anna)
        self.album.photos.add(self.anna_photo)
        self.share(self.ben, AlbumRole.CONTRIBUTOR)
        self.share(self.clara, AlbumRole.VIEWER)

    def share(self, user, role, shared=True):
        response = _client(self.anna).post(
            "/api/useralbum/share/",
            {
                "shared": shared,
                "target_user_id": user.pk,
                "album_id": self.album.pk,
                **({"role": role} if role else {}),
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        return response

    def add(self, user, photos, album=None):
        album = album or self.album
        return _client(user).post(
            f"/api/albums/user/{album.pk}/photos/add/",
            {"photos": [str(p.pk) for p in photos]},
            format="json",
        )

    def remove(self, user, photos):
        return _client(user).post(
            f"/api/albums/user/{self.album.pk}/photos/remove/",
            {"photos": [str(p.pk) for p in photos]},
            format="json",
        )

    def ben_adds(self):
        response = self.add(self.ben, [self.ben_photo])
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json(), {"count": 1})

    def grid_items(self, user):
        response = _client(user).get(f"/api/albums/user/{self.album.pk}/")
        self.assertEqual(response.status_code, 200, response.content)
        return {
            item["id"]: item
            for group in response.json()["grouped_photos"]
            for item in group["items"]
        }

    def media(self, user, path, photo):
        return _client(user).get(f"/media/{path}/{photo.image_hash}")

    def assert_no_original(self, response):
        """Not the original file: refused, or the copy without metadata."""
        if response.status_code == 200:
            self.assertIn(COPIES_DIR, response["X-Accel-Redirect"])

    def set_switches(self, user, **switches):
        response = _client(user).patch(
            f"/api/albums/user/{self.album.pk}/membership/", switches, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)


class AddingPhotosTest(CollaborativeAlbumBase):
    def test_a_contributor_adds_their_own_photo_which_keeps_its_owner(self):
        self.ben_adds()
        link = AlbumUserPhoto.objects.get(albumuser=self.album, photo=self.ben_photo)
        self.assertEqual(link.added_by, self.ben)
        self.ben_photo.refresh_from_db()
        self.assertEqual(self.ben_photo.owner, self.ben)
        self.assertIn(str(self.ben_photo.pk), self.grid_items(self.clara))

    def test_adding_twice_adds_once(self):
        self.ben_adds()
        self.assertEqual(self.add(self.ben, [self.ben_photo]).json(), {"count": 0})

    def test_a_viewer_cannot_add(self):
        clara_photo = create_test_photo(owner=self.clara)
        self.assertEqual(self.add(self.clara, [clara_photo]).status_code, 403)
        self.assertFalse(AlbumUserPhoto.objects.filter(photo=clara_photo).exists())

    def test_a_stranger_gets_a_404(self):
        mallory_photo = create_test_photo(owner=self.mallory)
        self.assertEqual(self.add(self.mallory, [mallory_photo]).status_code, 404)
        self.assertFalse(AlbumUserPhoto.objects.filter(photo=mallory_photo).exists())

    def test_nobody_adds_someone_elses_photo(self):
        # Anna's photo, a stranger's, and one mixed list: refused whole.
        mallory_photo = create_test_photo(owner=self.mallory)
        for photos in (
            [self.anna_photo],
            [mallory_photo],
            [self.ben_photo, mallory_photo],
        ):
            with self.subTest(photos=photos):
                self.assertEqual(self.add(self.ben, photos).status_code, 400)
        self.assertFalse(
            AlbumUserPhoto.objects.filter(albumuser=self.album)
            .exclude(photo=self.anna_photo)
            .exists()
        )
        self.assertEqual(self.add(self.ben, [Photo(pk=uuid.uuid4())]).status_code, 400)

    def test_select_all_only_ever_reaches_the_requesters_photos(self):
        response = _client(self.ben).post(
            f"/api/albums/user/{self.album.pk}/photos/add/",
            {
                "select_all": True,
                "query": {"public": True, "username": self.anna.username},
            },
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        owners = set(
            AlbumUserPhoto.objects.filter(albumuser=self.album).values_list(
                "photo__owner_id", flat=True
            )
        )
        self.assertEqual(owners, {self.anna.pk})

    def test_a_locked_album_takes_nothing(self):
        self.album.locked = True
        self.album.save()
        self.assertEqual(self.add(self.ben, [self.ben_photo]).status_code, 400)

    def test_a_hidden_photo_is_refused(self):
        self.ben_photo.hidden = True
        self.ben_photo.save()
        self.assertEqual(self.add(self.ben, [self.ben_photo]).status_code, 400)

    def test_the_owner_edit_endpoint_stays_owner_only(self):
        response = _client(self.ben).patch(
            f"/api/albums/user/edit/{self.album.pk}/",
            {"photos": [str(self.ben_photo.pk)]},
            format="json",
        )
        self.assertEqual(response.status_code, 404)

    def test_only_the_owner_renames_changes_roles_or_publishes(self):
        for user in (self.ben, self.clara):
            with self.subTest(user=user.username):
                client = _client(user)
                self.assertEqual(
                    client.patch(
                        f"/api/albums/user/{self.album.pk}/",
                        {"title": "pwned", "members_share_location": True},
                        format="json",
                    ).status_code,
                    404,
                )
                self.assertEqual(
                    client.post(
                        "/api/useralbum/share/",
                        {
                            "shared": True,
                            "target_user_id": self.mallory.pk,
                            "album_id": self.album.pk,
                            "role": "contributor",
                        },
                        format="json",
                    ).status_code,
                    400,
                )
                self.assertEqual(
                    client.post(
                        "/api/useralbum/makepublic/",
                        {"album_id": self.album.pk, "val_public": True},
                        format="json",
                    ).status_code,
                    403,
                )
        self.album.refresh_from_db()
        self.assertEqual(self.album.title, "Bruno and Mila")
        self.assertFalse(self.album.shared_to.filter(pk=self.mallory.pk).exists())


class RemovingPhotosTest(CollaborativeAlbumBase):
    def test_a_contributor_removes_only_their_own(self):
        """Someone else's photo is skipped like one the album does not hold:
        the answer is the same either way."""
        self.ben_adds()
        stranger = create_test_photo(owner=self.mallory)
        for photos in ([self.anna_photo], [stranger]):
            with self.subTest(photos=photos):
                response = self.remove(self.ben, photos)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json(), {"count": 0})
        self.assertEqual(self.album.photos.count(), 2)
        response = self.remove(self.ben, [self.anna_photo, self.ben_photo])
        self.assertEqual(response.json(), {"count": 1})
        self.assertEqual(list(self.album.photos.all()), [self.anna_photo])
        self.assertTrue(Photo.objects.filter(pk=self.ben_photo.pk).exists())

    def test_the_owner_removes_any_photo(self):
        self.ben_adds()
        self.assertEqual(self.remove(self.anna, [self.ben_photo]).json(), {"count": 1})
        self.assertTrue(Photo.objects.filter(pk=self.ben_photo.pk).exists())

    def test_a_viewer_and_a_stranger_remove_nothing(self):
        self.ben_adds()
        self.assertEqual(self.remove(self.clara, [self.ben_photo]).status_code, 403)
        self.assertEqual(self.remove(self.mallory, [self.ben_photo]).status_code, 404)
        self.assertEqual(self.album.photos.count(), 2)


class RevocationTest(CollaborativeAlbumBase):
    """Leaving the contributors stops the album vouching for their photos."""

    def assert_ben_photo_unreachable(self, user):
        self.assertNotIn(str(self.ben_photo.pk), self.grid_items(user))
        for path in ("thumbnails_big", "square_thumbnails", "photos"):
            with self.subTest(path=path):
                self.assertEqual(
                    self.media(user, path, self.ben_photo).status_code, 404
                )
        self.assertEqual(
            _client(user).get(f"/api/photos/{self.ben_photo.pk}/").status_code, 404
        )
        self.assertEqual(
            _client(user).get(f"/api/photos/{self.ben_photo.pk}/albums/").status_code,
            404,
        )

    def test_members_reach_the_photo_while_ben_contributes(self):
        self.ben_adds()
        for user in (self.anna, self.clara):
            with self.subTest(user=user.username):
                self.assertEqual(
                    self.media(user, "thumbnails_big", self.ben_photo).status_code, 200
                )
                self.assertEqual(
                    _client(user).get(f"/api/photos/{self.ben_photo.pk}/").status_code,
                    200,
                )
                albums = _client(user).get(f"/api/photos/{self.ben_photo.pk}/albums/")
                self.assertEqual(
                    [a["id"] for a in albums.json()["results"]], [self.album.pk]
                )

    def test_a_stranger_never_does(self):
        self.ben_adds()
        self.assertEqual(
            self.media(self.mallory, "thumbnails_big", self.ben_photo).status_code, 404
        )
        self.assertEqual(
            self.media(None, "thumbnails_big", self.ben_photo).status_code, 403
        )
        self.assertEqual(
            _client(self.mallory).get(f"/api/photos/{self.ben_photo.pk}/").status_code,
            404,
        )
        self.assertEqual(
            _client(self.mallory).get(f"/api/albums/user/{self.album.pk}/").status_code,
            404,
        )

    def test_becoming_a_viewer_takes_bens_photos_out(self):
        self.ben_adds()
        response = self.share(self.ben, AlbumRole.VIEWER)
        self.assertEqual(response.json()["my_role"], "owner")
        self.assertFalse(AlbumUserPhoto.objects.filter(photo=self.ben_photo).exists())
        self.assertTrue(Photo.objects.filter(pk=self.ben_photo.pk).exists())
        self.assert_ben_photo_unreachable(self.clara)

    def test_being_removed_takes_bens_photos_out(self):
        self.ben_adds()
        self.share(self.ben, None, shared=False)
        self.assertFalse(self.album.shared_to.filter(pk=self.ben.pk).exists())
        self.assertFalse(AlbumUserPhoto.objects.filter(photo=self.ben_photo).exists())
        self.assert_ben_photo_unreachable(self.clara)
        self.assert_ben_photo_unreachable(self.anna)

    def test_leaving_takes_bens_photos_out(self):
        self.ben_adds()
        response = _client(self.ben).post(
            "/api/useralbum/leave/", {"album_id": self.album.pk}, format="json"
        )
        self.assertEqual(response.status_code, 204)
        self.assertFalse(AlbumUserPhoto.objects.filter(photo=self.ben_photo).exists())
        self.assert_ben_photo_unreachable(self.clara)

    def test_a_link_left_behind_stops_vouching_at_once(self):
        """The rule, not the clean-up, revokes: a role change that skipped the
        service (a raw update) still stops every read path."""
        self.ben_adds()
        AlbumUserMember.objects.filter(albumuser=self.album, user=self.ben).update(
            role=AlbumRole.VIEWER
        )
        self.assertTrue(AlbumUserPhoto.objects.filter(photo=self.ben_photo).exists())
        self.assert_ben_photo_unreachable(self.clara)
        AlbumUserMember.objects.filter(albumuser=self.album, user=self.ben).delete()
        self.assert_ben_photo_unreachable(self.clara)

    def test_hiding_or_trashing_takes_the_photo_out_of_view(self):
        self.ben_adds()
        for field in ("hidden", "in_trashcan"):
            with self.subTest(field=field):
                Photo.objects.filter(pk=self.ben_photo.pk).update(**{field: True})
                self.assert_ben_photo_unreachable(self.clara)
                Photo.objects.filter(pk=self.ben_photo.pk).update(**{field: False})

    def test_a_link_to_someone_elses_photo_never_vouches(self):
        """Links not made by the photo's owner as a contributor: one from
        before #2008 (no added_by) and one the album owner made to a member's
        photo (added_by is not the photo's owner)."""
        legacy = create_test_photo(owner=self.mallory)
        AlbumUserPhoto.objects.create(albumuser=self.album, photo=legacy)
        AlbumUserPhoto.objects.create(
            albumuser=self.album, photo=self.ben_other, added_by=self.anna
        )
        for photo in (legacy, self.ben_other):
            with self.subTest(photo=photo.pk):
                self.assertNotIn(str(photo.pk), self.grid_items(self.clara))
                self.assertNotIn(str(photo.pk), self.grid_items(self.anna))
                self.assertEqual(
                    self.media(self.clara, "thumbnails_big", photo).status_code, 404
                )
                self.assertEqual(
                    _client(self.anna).get(f"/api/photos/{photo.pk}/").status_code,
                    404,
                )


class BothMustAllowTest(CollaborativeAlbumBase):
    """What members see of a photo: the album's ceiling AND its owner's choice."""

    def detail(self, user, photo):
        response = _client(user).get(f"/api/photos/{photo.pk}/")
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    def test_a_contributors_metadata_is_off_until_they_turn_it_on(self):
        self.ben_adds()
        item = self.grid_items(self.clara)[str(self.ben_photo.pk)]
        self.assertEqual(item["location"], "")
        self.assertIsNone(item["exif_gps_lat"])
        detail = self.detail(self.clara, self.ben_photo)
        self.assertIsNone(detail["exif_gps_lat"])
        self.assertIsNone(detail["camera"])
        self.assertEqual(detail["search_location"], "")
        self.assertEqual(detail["captions_json"], {"im2txt": ""})
        # The album owner is a member too: the same rule.
        self.assertIsNone(self.detail(self.anna, self.ben_photo)["exif_gps_lat"])
        # The original carries the metadata: never served, at most the copy
        # without it (api/tests/media_serving/test_collaborative_album_media.py).
        self.assert_no_original(self.media(self.clara, "photos", self.ben_photo))

    def test_both_on_shows_it(self):
        self.ben_adds()
        self.set_switches(
            self.ben,
            share_location=True,
            share_camera_info=True,
            share_captions=True,
            share_originals=True,
        )
        item = self.grid_items(self.clara)[str(self.ben_photo.pk)]
        self.assertEqual(item["location"], "Ben's Street")
        detail = self.detail(self.clara, self.ben_photo)
        self.assertEqual(detail["exif_gps_lat"], 52.5)
        self.assertEqual(detail["camera"], "BenCam")
        self.assertEqual(
            self.media(self.clara, "photos", self.ben_photo).status_code, 200
        )

    def test_the_owners_ceiling_wins_over_the_contributor(self):
        self.ben_adds()
        self.set_switches(self.ben, share_location=True, share_originals=True)
        response = _client(self.anna).patch(
            f"/api/albums/user/{self.album.pk}/",
            {"members_share_location": False, "members_share_originals": False},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertIsNone(self.detail(self.clara, self.ben_photo)["exif_gps_lat"])
        self.assertEqual(
            self.grid_items(self.clara)[str(self.ben_photo.pk)]["location"], ""
        )
        self.assert_no_original(self.media(self.clara, "photos", self.ben_photo))
        # The ceiling covers the owner's own photos for members too...
        self.assertEqual(
            self.grid_items(self.clara)[str(self.anna_photo.pk)]["location"], ""
        )
        self.assert_no_original(self.media(self.clara, "photos", self.anna_photo))
        # ...but never what the owner sees of their own photo.
        self.assertEqual(
            self.grid_items(self.anna)[str(self.anna_photo.pk)]["location"],
            "Anna's Garden",
        )

    def test_the_owner_of_the_photo_sees_everything(self):
        self.ben_adds()
        self.assertEqual(
            self.grid_items(self.ben)[str(self.ben_photo.pk)]["location"],
            "Ben's Street",
        )
        self.assertEqual(self.detail(self.ben, self.ben_photo)["camera"], "BenCam")

    def test_never_shared_fields_stay_out_whatever_the_switches(self):
        self.ben_adds()
        self.set_switches(
            self.ben,
            share_location=True,
            share_faces=True,
            share_camera_info=True,
            share_captions=True,
            share_originals=True,
        )
        detail = self.detail(self.clara, self.ben_photo)
        self.assertEqual(detail["image_path"], [])
        self.assertEqual(detail["similar_photos"], [])
        self.assertEqual(detail["shared_to"], [])
        self.assertIsNone(detail["metadata"])
        self.assertIsNone(detail["file_variants"])
        self.assertEqual(detail["search_captions"], "")
        self.assertEqual(detail["rating"], 0)
        self.assertFalse(detail["public"])
        self.assertIsNone(detail["exif_timestamp_source"])

    def test_people_names_need_both_sides(self):
        friend = create_test_person(name="BenFriend", cluster_owner=self.ben)
        create_test_face(photo=self.ben_photo, person=friend)
        self.ben_adds()
        self.assertEqual(self.detail(self.clara, self.ben_photo)["people"], [])
        self.set_switches(self.ben, share_faces=True)
        names = [p["name"] for p in self.detail(self.clara, self.ben_photo)["people"]]
        self.assertEqual(names, ["BenFriend"])
        self.album.members_share_faces = False
        self.album.save()
        self.assertEqual(self.detail(self.clara, self.ben_photo)["people"], [])

    def test_a_library_share_decides_for_its_owners_photos(self):
        """Ben shares his whole library with Clara (#2731): its switches,
        not the album's, say what she sees of his photos, in the album too."""
        self.ben_adds()
        create_test_library_share(
            owner=self.ben, recipient=self.clara, share_location=True
        )
        self.assertEqual(
            self.grid_items(self.clara)[str(self.ben_photo.pk)]["location"],
            "Ben's Street",
        )
        detail = self.detail(self.clara, self.ben_photo)
        self.assertEqual(detail["exif_gps_lat"], 52.5)
        self.assertIsNone(detail["camera"])
        self.assertEqual(detail["image_path"], [])
        # Anna has no share of Ben's library: the album's rule for her.
        self.assertIsNone(self.detail(self.anna, self.ben_photo)["exif_gps_lat"])

    def test_switches_are_the_members_own(self):
        for user in (self.anna, self.mallory):
            with self.subTest(user=user.username):
                response = _client(user).patch(
                    f"/api/albums/user/{self.album.pk}/membership/",
                    {"share_location": True},
                    format="json",
                )
                self.assertEqual(response.status_code, 404)
        self.assertFalse(AlbumUserMember.objects.filter(share_location=True).exists())


class NeverOutsideTheAlbumTest(CollaborativeAlbumBase):
    """A public link, search, the timeline, zips and Shared-with-you lists."""

    def test_a_public_link_shows_only_the_owners_photos(self):
        self.ben_adds()
        self.set_switches(self.ben, share_location=True, share_originals=True)
        # Every Photo Details switch on: the link hands out the original.
        share = AlbumUserShare.objects.create(  # raw-create: a public link
            album=self.album,
            enabled=True,
            **dict.fromkeys(get_default_public_sharing_settings(), True),
        )
        anonymous = _client(None)
        for url, key in (
            (f"/api/albums/user/{self.album.pk}/?public=true", None),
            (f"/api/public/albums/s/{share.slug}/", "results"),
        ):
            with self.subTest(url=url):
                response = anonymous.get(url)
                self.assertEqual(response.status_code, 200, response.content)
                body = response.json()
                album = body[key] if key else body
                ids = {
                    item["id"]
                    for group in album["grouped_photos"]
                    for item in group["items"]
                }
                self.assertEqual(ids, {str(self.anna_photo.pk)})
                self.assertNotIn(self.ben_photo.image_hash, response.content.decode())
        for ref in (str(self.ben_photo.pk), self.ben_photo.image_hash):
            with self.subTest(ref=ref):
                response = anonymous.get(
                    f"/api/public/albums/s/{share.slug}/photos/{ref}/"
                )
                self.assertEqual(response.status_code, 404)
        response = anonymous.get(
            f"/api/public/albums/s/{share.slug}/photos/{self.anna_photo.pk}/"
        )
        self.assertEqual(response.status_code, 200)
        for path in ("thumbnails_big", "photos"):
            with self.subTest(path=path):
                self.assertEqual(
                    self.media(None, path, self.ben_photo).status_code, 403
                )
                self.assertEqual(
                    self.media(None, path, self.anna_photo).status_code, 200
                )

    def test_the_album_owners_search_and_timeline_never_list_it(self):
        self.ben_adds()
        client = _client(self.anna)
        search = client.get("/api/photos/searchlist/?search=ben")
        self.assertNotIn(self.ben_photo.image_hash, search.content.decode())
        days = client.get("/api/albums/date/list/")
        self.assertNotIn(self.ben_photo.image_hash, days.content.decode())

    def test_nobody_zips_a_contributors_photo(self):
        self.ben_adds()
        for user in (self.anna, self.clara):
            with self.subTest(user=user.username):
                response = _client(user).post(
                    "/api/photos/download",
                    {"image_hashes": [self.ben_photo.image_hash]},
                    format="json",
                )
                self.assertEqual(response.status_code, 404)

    def test_shared_with_you_places_leave_it_out(self):
        self.ben_adds()
        self.set_switches(self.ben, share_location=True)
        place = create_test_album_place(title="BenPlaceTitle", owner=self.ben)
        place.photos.add(self.ben_photo)
        body = _client(self.clara).get("/api/photos/shared/tome/places/").content
        self.assertNotIn(b"BenPlaceTitle", body)

    def test_the_album_list_cover_is_never_a_contributors_photo(self):
        self.album.photos.remove(self.anna_photo)
        self.ben_adds()
        response = _client(self.clara).get("/api/albums/user/shared/tome/")
        card = response.json()["results"][0]
        self.assertIsNone(card["cover_photo"])
        self.assertEqual(card["photo_count"], 1)
        self.assertEqual(card["my_role"], "viewer")


class MembersListTest(CollaborativeAlbumBase):
    def test_roles_counts_and_my_role(self):
        self.ben_adds()
        body = _client(self.clara).get(f"/api/albums/user/{self.album.pk}/").json()
        members = {
            m["user"]["id"]: (m["role"], m["photo_count"]) for m in body["members"]
        }
        self.assertEqual(
            members, {self.ben.pk: ("contributor", 1), self.clara.pk: ("viewer", 0)}
        )
        self.assertEqual(body["my_role"], "viewer")
        self.assertEqual(body["my_switches"]["share_location"], False)
        owner = _client(self.anna).get(f"/api/albums/user/{self.album.pk}/").json()
        self.assertEqual(owner["my_role"], "owner")
        self.assertIsNone(owner["my_switches"])

    def test_the_owner_cannot_be_their_own_member(self):
        response = _client(self.anna).post(
            "/api/useralbum/share/",
            {
                "shared": True,
                "target_user_id": self.anna.pk,
                "album_id": self.album.pk,
                "role": "contributor",
            },
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_resharing_without_a_role_keeps_it(self):
        _client(self.anna).post(
            "/api/useralbum/share/",
            {"shared": True, "target_user_id": self.ben.pk, "album_id": self.album.pk},
            format="json",
        )
        self.assertEqual(
            AlbumUserMember.objects.get(albumuser=self.album, user=self.ben).role,
            AlbumRole.CONTRIBUTOR,
        )

    def test_a_contributor_sees_the_album_among_those_they_can_add_to(self):
        response = _client(self.ben).get("/api/albums/user/shared/tome/")
        roles = {a["id"]: a["my_role"] for a in response.json()["results"]}
        self.assertEqual(roles, {self.album.pk: "contributor"})
