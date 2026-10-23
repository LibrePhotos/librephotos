"""Comments and likes in shared albums (#262), adversarially.

Anna owns "Bruno and Mila" and shares it with Ben (contributor) and Clara
(viewer); Mallory is in no album. A thread belongs to one photo in one album
and only that album's owner and members reach it, only while the album shows
the photo. Comments are plain text with a length limit and a rate limit;
authors edit and delete their own, the owner deletes any and can turn
comments off.
"""

from unittest.mock import patch

from django.core.cache import cache
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from api.accounts.throttling import AlbumCommentRateThrottle
from api.albums import members
from api.albums.comments import MAX_COMMENT_LENGTH
from api.models import AlbumComment, AlbumLike, AlbumRole, Photo
from api.tests.utils import (
    create_test_album_comment,
    create_test_album_like,
    create_test_album_user,
    create_test_photo,
    create_test_user,
)


def _client(user):
    client = APIClient()
    if user is not None:
        client.force_authenticate(user=user)
    return client


class AlbumCommentsBase(TestCase):
    def setUp(self):
        cache.clear()
        self.anna = create_test_user()
        self.ben = create_test_user()
        self.clara = create_test_user()
        self.mallory = create_test_user()
        self.anna_photo = create_test_photo(owner=self.anna)
        self.ben_photo = create_test_photo(owner=self.ben)
        self.album = create_test_album_user(owner=self.anna, title="Bruno and Mila")
        self.album.photos.add(self.anna_photo)
        members.set_member_role(self.album, self.ben, AlbumRole.CONTRIBUTOR)
        members.set_member_role(self.album, self.clara, AlbumRole.VIEWER)
        members.add_photos(
            self.album, self.ben, Photo.objects.filter(pk=self.ben_photo.pk)
        )

    def url(self, photo=None, album=None, suffix="comments/"):
        album = album or self.album
        photo = photo or self.anna_photo
        return f"/api/albums/user/{album.pk}/photos/{photo.pk}/{suffix}"

    def post(self, user, text, photo=None):
        return _client(user).post(self.url(photo), {"text": text}, format="json")

    def thread(self, user, photo=None):
        return _client(user).get(self.url(photo))


class ReadingTest(AlbumCommentsBase):
    def test_members_read_the_thread(self):
        create_test_album_comment(self.album, self.anna_photo, self.ben, "Good boy")
        for user in (self.anna, self.ben, self.clara):
            with self.subTest(user=user.username):
                response = self.thread(user)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(
                    [c["text"] for c in response.json()["results"]], ["Good boy"]
                )

    def test_nobody_else_does(self):
        create_test_album_comment(self.album, self.anna_photo, self.ben, "Secret")
        response = self.thread(self.mallory)
        self.assertEqual(response.status_code, 404)
        self.assertNotIn(b"Secret", response.content)
        self.assertEqual(self.thread(None).status_code, 401)

    def test_a_thread_belongs_to_the_album(self):
        """The same photo in Anna's other album, shared with Mallory, has its
        own thread: Mallory never sees this album's comments through it."""
        other = create_test_album_user(owner=self.anna, title="Dogs")
        other.photos.add(self.anna_photo)
        members.set_member_role(other, self.mallory, AlbumRole.VIEWER)
        create_test_album_comment(self.album, self.anna_photo, self.ben, "Secret")
        response = _client(self.mallory).get(self.url(album=other))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["results"], [])
        self.assertEqual(_client(self.mallory).get(self.url()).status_code, 404)

    def test_a_photo_the_album_does_not_show_has_no_thread(self):
        """Not in the album, hidden, or a link that no longer vouches: 404."""
        stray = create_test_photo(owner=self.anna)
        self.assertEqual(self.thread(self.clara, stray).status_code, 404)
        Photo.objects.filter(pk=self.anna_photo.pk).update(hidden=True)
        self.assertEqual(self.thread(self.clara).status_code, 404)

    def test_a_revoked_contributors_photo_loses_its_thread(self):
        create_test_album_comment(self.album, self.ben_photo, self.clara, "Cute")
        create_test_album_like(self.album, self.ben_photo, self.clara)
        members.set_member_role(self.album, self.ben, AlbumRole.VIEWER)
        self.assertEqual(self.thread(self.clara, self.ben_photo).status_code, 404)
        self.assertFalse(AlbumComment.objects.filter(photo=self.ben_photo).exists())
        self.assertFalse(AlbumLike.objects.filter(photo=self.ben_photo).exists())

    def test_a_photo_taken_out_takes_its_thread(self):
        create_test_album_comment(self.album, self.anna_photo, self.ben, "Bye")
        response = _client(self.anna).patch(
            f"/api/albums/user/edit/{self.album.pk}/",
            {"removedPhotos": [self.anna_photo.image_hash]},
            format="json",
        )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(AlbumComment.objects.exists())

    def test_a_member_who_left_reads_nothing(self):
        create_test_album_comment(self.album, self.anna_photo, self.ben, "Hi")
        _client(self.clara).post(
            "/api/useralbum/leave/", {"album_id": self.album.pk}, format="json"
        )
        self.assertEqual(self.thread(self.clara).status_code, 404)

    def test_the_thread_costs_the_same_for_many_comments(self):
        def count():
            with CaptureQueriesContext(connection) as queries:
                self.assertEqual(self.thread(self.clara).status_code, 200)
            return len(queries)

        create_test_album_comment(self.album, self.anna_photo, self.ben)
        few = count()
        for _ in range(6):
            create_test_album_comment(self.album, self.anna_photo, self.clara)
        self.assertEqual(count(), few)


class WritingTest(AlbumCommentsBase):
    def test_every_member_comments(self):
        for user in (self.anna, self.ben, self.clara):
            with self.subTest(user=user.username):
                response = self.post(user, f"From {user.username}")
                self.assertEqual(response.status_code, 201, response.content)
                body = response.json()
                self.assertEqual(body["author"]["id"], user.pk)
                self.assertTrue(body["can_edit"])
                self.assertTrue(body["can_delete"])

    def test_a_stranger_cannot(self):
        self.assertEqual(self.post(self.mallory, "spam").status_code, 404)
        self.assertEqual(self.post(None, "spam").status_code, 401)
        self.assertFalse(AlbumComment.objects.exists())

    def test_the_text_is_plain_and_kept_as_typed(self):
        """Markup is stored and answered as text; JSON escapes it, clients show
        it as text. Control characters and direction overrides go."""
        text = '<img src=x onerror=alert(1)><script>alert("x")</script>'
        response = self.post(self.clara, f"  {text}\u202e\x07\n  ")
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json()["text"], text)
        self.assertEqual(response["Content-Type"], "application/json")
        self.assertEqual(AlbumComment.objects.get().text, text)

    def test_blank_and_too_long_are_refused(self):
        for text in ("", "   \n ", "\x00\u202e"):
            with self.subTest(text=text):
                self.assertEqual(self.post(self.clara, text).status_code, 400)
        self.assertEqual(
            self.post(self.clara, "x" * MAX_COMMENT_LENGTH).status_code, 201
        )
        self.assertEqual(
            self.post(self.clara, "x" * (MAX_COMMENT_LENGTH + 1)).status_code, 400
        )

    def test_it_is_rate_limited(self):
        with patch.object(AlbumCommentRateThrottle, "rate", "3/min"):
            codes = [self.post(self.clara, f"#{i}").status_code for i in range(4)]
        self.assertEqual(codes, [201, 201, 201, 429])
        self.assertEqual(AlbumComment.objects.count(), 3)

    def test_the_owner_turns_comments_off(self):
        response = _client(self.anna).patch(
            f"/api/albums/user/{self.album.pk}/",
            {"comments_enabled": False},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        response = self.post(self.clara, "Hello")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["errors"][0]["code"], "comments_off")
        likes = _client(self.clara).put(self.url(suffix="likes/"))
        self.assertEqual(likes.status_code, 403)
        self.assertFalse(AlbumLike.objects.exists())
        # Only the owner switches it.
        response = _client(self.ben).patch(
            f"/api/albums/user/{self.album.pk}/",
            {"comments_enabled": True},
            format="json",
        )
        self.assertEqual(response.status_code, 404)


class ModerationTest(AlbumCommentsBase):
    def setUp(self):
        super().setUp()
        self.comment = create_test_album_comment(
            self.album, self.anna_photo, self.ben, "Original"
        )

    def comment_url(self, comment=None, photo=None):
        comment = comment or self.comment
        return self.url(photo) + f"{comment.pk}/"

    def test_only_the_author_edits(self):
        for user in (self.anna, self.clara):
            with self.subTest(user=user.username):
                response = _client(user).patch(
                    self.comment_url(), {"text": "pwned"}, format="json"
                )
                self.assertEqual(response.status_code, 403)
        response = _client(self.ben).patch(
            self.comment_url(), {"text": "Edited"}, format="json"
        )
        self.assertEqual(response.status_code, 200)
        self.assertIsNotNone(response.json()["edited_at"])
        self.comment.refresh_from_db()
        self.assertEqual(self.comment.text, "Edited")

    def test_the_author_and_the_owner_delete(self):
        self.assertEqual(
            _client(self.clara).delete(self.comment_url()).status_code, 403
        )
        self.assertEqual(_client(self.anna).delete(self.comment_url()).status_code, 204)
        own = create_test_album_comment(self.album, self.anna_photo, self.clara)
        self.assertEqual(
            _client(self.clara).delete(self.comment_url(own)).status_code, 204
        )
        self.assertFalse(AlbumComment.objects.exists())

    def test_what_each_reader_may_do_is_said(self):
        rows = self.thread(self.clara).json()["results"]
        self.assertEqual((rows[0]["can_edit"], rows[0]["can_delete"]), (False, False))
        rows = self.thread(self.anna).json()["results"]
        self.assertEqual((rows[0]["can_edit"], rows[0]["can_delete"]), (False, True))

    def test_a_comment_is_reached_only_through_its_own_thread(self):
        """Another photo's or another album's path to the same id is a 404."""
        other = create_test_album_user(owner=self.mallory)
        mallory_photo = create_test_photo(owner=self.mallory)
        other.photos.add(mallory_photo)
        for client, url in (
            (_client(self.anna), self.comment_url(photo=self.ben_photo)),
            (
                _client(self.mallory),
                f"/api/albums/user/{other.pk}/photos/{mallory_photo.pk}/comments/{self.comment.pk}/",
            ),
        ):
            with self.subTest(url=url):
                self.assertEqual(client.delete(url).status_code, 404)
                self.assertEqual(
                    client.patch(url, {"text": "x"}, format="json").status_code, 404
                )
        self.assertTrue(AlbumComment.objects.filter(pk=self.comment.pk).exists())


class LikesTest(AlbumCommentsBase):
    def likes(self, user, method="get"):
        return getattr(_client(user), method)(self.url(suffix="likes/"))

    def test_hearting_is_once_per_member_and_undoable(self):
        self.assertEqual(self.likes(self.clara, "put").json()["count"], 1)
        body = self.likes(self.clara, "put").json()
        self.assertEqual((body["count"], body["liked_by_me"]), (1, True))
        body = self.likes(self.ben, "put").json()
        self.assertEqual([u["id"] for u in body["users"]], [self.clara.pk, self.ben.pk])
        body = self.likes(self.clara, "delete").json()
        self.assertEqual((body["count"], body["liked_by_me"]), (1, False))

    def test_strangers_neither_see_nor_heart(self):
        create_test_album_like(self.album, self.anna_photo, self.clara)
        for method in ("get", "put", "delete"):
            with self.subTest(method=method):
                self.assertEqual(self.likes(self.mallory, method).status_code, 404)
        self.assertEqual(AlbumLike.objects.count(), 1)
