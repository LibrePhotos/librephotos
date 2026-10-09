"""/api/delete/user/ deletes a user and does nothing else.

It used to be a full ModelViewSet over a serializer of every User column: an
admin could GET a user's password hash from it, and PUT or PATCH a
scan_directory or upload_directory past the DATA_ROOT and overlap checks that
/api/manage/user/ enforces.
"""

from django.test import Client, TestCase
from django.utils import timezone
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from api.models import (
    AlbumAuto,
    AlbumDate,
    AlbumPlace,
    AlbumThing,
    AlbumUser,
    AlbumUserShare,
    Photo,
    PhotoShare,
    Tag,
    User,
)
from api.tests.utils import create_test_photo, create_test_user


class DeleteUserEndpointTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        self.admin = create_test_user(is_admin=True)
        self.user = create_test_user(scan_directory="/data/user")
        self.other = create_test_user()

    def url(self, user):
        return f"/api/delete/user/{user.id}/"

    def test_admin_cannot_read_a_user_through_it(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get(self.url(self.user))
        self.assertEqual(405, response.status_code)
        self.assertNotIn(b"password", response.content)

    def test_admin_cannot_list_users_through_it(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.get("/api/delete/user/")
        self.assertEqual(404, response.status_code)

    def test_admin_cannot_create_a_user_through_it(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.post(
            "/api/delete/user/", data={"username": "sneaky", "password": "x"}
        )
        self.assertEqual(404, response.status_code)
        self.assertFalse(User.objects.filter(username="sneaky").exists())

    def test_admin_cannot_patch_a_scan_directory_through_it(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.patch(
            self.url(self.user), data={"scan_directory": "/etc"}, format="json"
        )
        self.assertEqual(405, response.status_code)
        self.user.refresh_from_db()
        self.assertEqual("/data/user", self.user.scan_directory)

    def test_admin_cannot_put_an_upload_directory_through_it(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.put(
            self.url(self.user),
            data={"username": self.user.username, "upload_directory": "/etc"},
            format="json",
        )
        self.assertEqual(405, response.status_code)
        self.user.refresh_from_db()
        self.assertNotEqual("/etc", self.user.upload_directory)

    def test_admin_deletes_a_user(self):
        self.client.force_authenticate(user=self.admin)
        response = self.client.delete(self.url(self.user))
        self.assertEqual(204, response.status_code)
        self.assertFalse(User.objects.filter(id=self.user.id).exists())

    def test_admin_still_cannot_delete_another_admin(self):
        other_admin = create_test_user(is_admin=True)
        self.client.force_authenticate(user=self.admin)
        response = self.client.delete(self.url(other_admin))
        self.assertEqual(400, response.status_code)
        self.assertTrue(User.objects.filter(id=other_admin.id).exists())

    def test_admin_cannot_delete_the_deleted_placeholder(self):
        # It holds every deleted user's library; its rows would be handed to
        # itself.
        photo = create_test_photo(owner=self.user)
        self.client.force_authenticate(user=self.admin)
        self.client.delete(self.url(self.user))
        placeholder = User.objects.get(username="deleted")
        response = self.client.delete(self.url(placeholder))
        self.assertEqual(400, response.status_code)
        self.assertTrue(User.objects.filter(id=placeholder.id).exists())
        self.assertTrue(Photo.objects.filter(pk=photo.pk, owner=placeholder).exists())

    def test_regular_user_cannot_delete_a_user(self):
        self.client.force_authenticate(user=self.other)
        response = self.client.delete(self.url(self.user))
        self.assertEqual(403, response.status_code)
        self.assertTrue(User.objects.filter(id=self.user.id).exists())

    def test_anonymous_cannot_delete_a_user(self):
        response = self.client.delete(self.url(self.user))
        self.assertIn(response.status_code, (401, 403))
        self.assertTrue(User.objects.filter(id=self.user.id).exists())

    def test_the_user_endpoints_do_not_delete(self):
        # They had no superuser guard: an admin could delete another admin, or
        # the last one, putting the instance back into first-time setup.
        other_admin = create_test_user(is_admin=True)
        self.client.force_authenticate(user=self.admin)
        for prefix in ("/api/user/", "/api/manage/user/"):
            for target in (self.admin, other_admin, self.user):
                with self.subTest(prefix=prefix, target=target.username):
                    response = self.client.delete(f"{prefix}{target.id}/")
                    self.assertEqual(405, response.status_code)
                    self.assertTrue(User.objects.filter(id=target.id).exists())


class DeleteUsersWithOverlappingAlbumsTest(TestCase):
    """Every owned row goes to the ``deleted`` account, unique per owner.

    The second user deleted with an album or tag matching what the first one
    left there failed with a 500 and stayed.
    """

    def setUp(self):
        self.client = APIClient()
        self.admin = create_test_user(is_admin=True)
        self.client.force_authenticate(user=self.admin)
        self.viewer = create_test_user()
        self.when = timezone.now()
        self.first, self.second = create_test_user(), create_test_user()
        self.photos = [self._library(user) for user in (self.first, self.second)]
        # The second user's album is shared and public; the first one's is not.
        holiday = AlbumUser.objects.get(owner=self.second, title="Holiday")
        holiday.shared_to.add(self.viewer)
        AlbumUserShare.objects.create(album=holiday, enabled=True, slug="holiday")

    def _library(self, owner):
        photo = create_test_photo(owner=owner, exif_timestamp=self.when)
        rows = [
            AlbumAuto.objects.create(
                owner=owner, timestamp=self.when, created_on=self.when
            ),
            AlbumDate.objects.create(owner=owner, date=self.when.date()),
            AlbumDate.objects.create(owner=owner, date=None),
            AlbumPlace.objects.create(owner=owner, title="Lisbon"),
            AlbumThing.objects.create(
                owner=owner, title="beach", thing_type="places365_attribute"
            ),
            AlbumUser.objects.create(owner=owner, title="Holiday"),
            Tag.objects.create(owner=owner, name="family"),
        ]
        for row in rows:
            row.photos.add(photo)
        return photo

    def _delete(self, user):
        response = self.client.delete(f"/api/delete/user/{user.id}/")
        self.assertEqual(204, response.status_code)
        self.assertFalse(User.objects.filter(id=user.id).exists())

    def _photos(self, row):
        return set(row.photos.values_list("pk", flat=True))

    def test_two_users_with_the_same_albums_and_tags_can_be_deleted(self):
        self._delete(self.first)
        self._delete(self.second)

        deleted = User.objects.get(username="deleted")
        first_photo, second_photo = (photo.pk for photo in self.photos)
        self.assertEqual(Photo.objects.filter(owner=deleted).count(), 2)

        # Generated albums: the one already there stays as it was.
        for model, key in (
            (AlbumAuto, {"timestamp": self.when}),
            (AlbumDate, {"date": self.when.date()}),
            (AlbumPlace, {"title": "Lisbon"}),
            (AlbumThing, {"title": "beach"}),
        ):
            with self.subTest(model=model.__name__):
                row = model.objects.get(owner=deleted, **key)
                self.assertEqual(self._photos(row), {first_photo})
        # A null date never collides, so each undated album is kept.
        self.assertEqual(AlbumDate.objects.filter(owner=deleted, date=None).count(), 2)

        # User albums are not mixed: the second keeps its photos and viewer
        # under a title naming its owner. Its public link is turned off.
        first_album = AlbumUser.objects.get(owner=deleted, title="Holiday")
        self.assertEqual(self._photos(first_album), {first_photo})
        self.assertFalse(first_album.shared_to.exists())
        second_album = AlbumUser.objects.get(
            owner=deleted, title=f"Holiday ({self.second.username})"
        )
        self.assertEqual(self._photos(second_album), {second_photo})
        self.assertEqual(list(second_album.shared_to.all()), [self.viewer])
        self.assertFalse(second_album.share.is_active())

        # Tags with the same name are the same keyword: merged.
        tag = Tag.objects.get(owner=deleted, name="family")
        self.assertEqual(self._photos(tag), {first_photo, second_photo})
        self.assertEqual(tag.photo_count, 2)

    def test_a_renamed_album_does_not_take_another_albums_title(self):
        AlbumUser.objects.create(
            owner=self.second, title=f"Holiday ({self.second.username})"
        )
        self._delete(self.first)
        self._delete(self.second)

        deleted = User.objects.get(username="deleted")
        self.assertCountEqual(
            AlbumUser.objects.filter(owner=deleted).values_list("title", flat=True),
            [
                "Holiday",
                f"Holiday ({self.second.username})",
                f"Holiday ({self.second.username} 2)",
            ],
        )

    def test_the_django_admin_deletes_both_at_once(self):
        # "Delete selected" hands both libraries over in one delete, so the
        # two users' albums would collide with each other too.
        admin = Client()
        admin.force_login(self.admin)
        response = admin.post(
            "/api/django-admin/api/user/",
            {
                "action": "delete_selected",
                "_selected_action": [self.first.pk, self.second.pk],
                "post": "yes",
            },
        )
        self.assertEqual(302, response.status_code)
        self.assertFalse(
            User.objects.filter(pk__in=(self.first.pk, self.second.pk)).exists()
        )

        deleted = User.objects.get(username="deleted")
        titles = set(
            AlbumUser.objects.filter(owner=deleted).values_list("title", flat=True)
        )
        self.assertIn(
            titles,
            [
                {"Holiday", f"Holiday ({user.username})"}
                for user in (self.first, self.second)
            ],
        )
        self.assertEqual(Tag.objects.filter(owner=deleted, name="family").count(), 1)
        self.assertFalse(AlbumUserShare.objects.filter(enabled=True).exists())


def _client_for(user):
    """The media view reads the raw ``jwt`` cookie, not force_authenticate."""
    client = APIClient()
    if user is not None:
        client.cookies["jwt"] = str(RefreshToken.for_user(user).access_token)
    return client


class DeletedUsersPublicLinksTest(TestCase):
    """A deleted user's public links stop working.

    They used to keep working under ``deleted``, which nobody can sign in as,
    so nobody could turn them off any more.
    """

    def setUp(self):
        self.admin_user = create_test_user(is_admin=True)
        self.admin = APIClient()
        self.admin.force_authenticate(user=self.admin_user)
        self.anonymous = _client_for(None)
        self.owner = create_test_user(public_sharing=True)
        self.viewer = create_test_user()
        when = timezone.now()

        self.album_photo = create_test_photo(owner=self.owner)
        album = AlbumUser.objects.create(owner=self.owner, title="Trip")
        album.photos.add(self.album_photo)
        album.shared_to.add(self.viewer)
        AlbumUserShare.objects.create(album=album, enabled=True, slug="trip")

        self.public_photo = create_test_photo(
            owner=self.owner, public=True, exif_timestamp=when
        )
        AlbumDate.objects.create(owner=self.owner, date=when.date()).photos.add(
            self.public_photo
        )

        self.linked_photo = create_test_photo(owner=self.owner)
        self.photo_slug = PhotoShare.objects.create(
            photo=self.linked_photo, enabled=True
        ).slug

    def _public_urls(self):
        """Each URL a visitor without an account could open, and its refusal.

        The /media/ view answers 403 to an anonymous visitor it refuses.
        """
        album_media = f"/media/thumbnails_big/{self.album_photo.image_hash}"
        public_media = f"/media/thumbnails_big/{self.public_photo.image_hash}"
        photo_link = f"/api/public/photo/{self.photo_slug}/"
        return {
            "/api/public/albums/s/trip/": 404,
            f"/api/public/albums/s/trip/photos/{self.album_photo.id}/": 404,
            album_media: 403,
            public_media: 403,
            photo_link: 404,
            f"{photo_link}media/thumbnail/": 404,
        }

    def _public_timeline(self, username):
        response = self.anonymous.get(
            "/api/albums/date/list/", {"public": "true", "username": username}
        )
        self.assertEqual(200, response.status_code)
        return response.json()["results"]

    def test_the_links_work_before_the_delete(self):
        # So the test below fails for its own reason.
        for url in self._public_urls():
            with self.subTest(url):
                self.assertEqual(200, self.anonymous.get(url).status_code)
        self.assertEqual(1, len(self._public_timeline(self.owner.username)))

    def test_deleting_the_user_turns_the_links_off(self):
        response = self.admin.delete(f"/api/delete/user/{self.owner.id}/")
        self.assertEqual(204, response.status_code)
        self._assert_links_off()

    def test_deleting_the_user_in_the_django_admin_turns_the_links_off(self):
        admin = Client()
        admin.force_login(self.admin_user)
        response = admin.post(
            f"/api/django-admin/api/user/{self.owner.id}/delete/", {"post": "yes"}
        )
        self.assertEqual(302, response.status_code)
        self.assertFalse(User.objects.filter(id=self.owner.id).exists())
        self._assert_links_off()

    def _assert_links_off(self):
        for url, refused in self._public_urls().items():
            with self.subTest(url):
                self.assertEqual(refused, self.anonymous.get(url).status_code)
        self.assertEqual([], self._public_timeline("deleted"))
        self.assertFalse(Photo.objects.filter(public=True).exists())
        self.assertFalse(AlbumUserShare.objects.filter(enabled=True).exists())
        self.assertFalse(PhotoShare.objects.filter(enabled=True).exists())

    def test_the_users_it_was_shared_with_keep_it(self):
        self.admin.delete(f"/api/delete/user/{self.owner.id}/")

        response = _client_for(self.viewer).get(
            f"/media/thumbnails_big/{self.album_photo.image_hash}"
        )
        self.assertEqual(200, response.status_code)


class DeletedUsersAlbumsOfOthersPhotosTest(TestCase):
    """An album still vouches only for its owner's photos (GHSA-phvg-g65q-rhq3).

    A shares a photo with B, B puts it in an album shared with C. C never got
    the photo through that album. Once A and B are both deleted, ``deleted``
    owns the album and the photo, and the album vouched for it.
    """

    def setUp(self):
        self.admin = APIClient()
        self.admin.force_authenticate(user=create_test_user(is_admin=True))
        self.photo_owner, self.album_owner = create_test_user(), create_test_user()
        self.viewer = create_test_user()
        self.photo = create_test_photo(owner=self.photo_owner)
        self.photo.shared_to.add(self.album_owner)
        self.own_photo = create_test_photo(owner=self.album_owner)
        self.album = AlbumUser.objects.create(
            owner=self.album_owner, title="Mixed", cover_photo=self.photo
        )
        self.album.photos.add(self.photo, self.own_photo)
        self.album.shared_to.add(self.viewer)

    def _status(self, photo):
        url = f"/media/thumbnails_big/{photo.image_hash}"
        return _client_for(self.viewer).get(url).status_code

    def _delete(self, *users):
        for user in users:
            response = self.admin.delete(f"/api/delete/user/{user.id}/")
            self.assertEqual(204, response.status_code)

    def _assert_album_keeps_only_its_owners_photos(self):
        self.assertEqual(404, self._status(self.photo))
        self.assertEqual(200, self._status(self.own_photo))
        self.album.refresh_from_db()
        self.assertEqual(
            [self.own_photo.pk], list(self.album.photos.values_list("pk", flat=True))
        )
        self.assertIsNone(self.album.cover_photo)

    def test_the_album_does_not_vouch_for_it_before(self):
        # So the tests below fail for their own reason.
        self.assertEqual(404, self._status(self.photo))
        self.assertEqual(200, self._status(self.own_photo))

    def test_deleting_the_photos_owner_first(self):
        self._delete(self.photo_owner, self.album_owner)
        self._assert_album_keeps_only_its_owners_photos()

    def test_deleting_the_albums_owner_first(self):
        self._delete(self.album_owner, self.photo_owner)
        self._assert_album_keeps_only_its_owners_photos()
