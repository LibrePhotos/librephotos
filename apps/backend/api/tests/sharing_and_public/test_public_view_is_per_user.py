"""The public view of the day albums (``?public``) is one user's public profile.

Up to the public gallery (#434), ``/api/albums/date/list/?public=true``
without a ``username`` listed every user's public photos to anyone, whether
they had a public profile or not: a combined timeline outside the gallery's
switches (off by default, users opt in). Now the public view needs a
``username`` whose public profile (``public_sharing``) is on, else it is a
404; only the user themselves reads their own public days with it off (the
Public Links page). Everyone's public photos together are the gallery's.
"""

import datetime

from django.test import TestCase
from rest_framework.test import APIClient

from api.tests.sharing_and_public.gallery_fixtures import gallery
from api.tests.utils import create_test_album_date, create_test_photo, create_test_user

TAKEN = datetime.datetime(2024, 7, 14, 12, 0, tzinfo=datetime.UTC)


class PublicViewIsPerUserTest(TestCase):
    def setUp(self):
        self.profile = create_test_user(public_sharing=True)
        self.private = create_test_user(public_sharing=False, in_public_gallery=False)
        self.days = {
            user.username: self.public_day(user)
            for user in (self.profile, self.private)
        }
        self.anonymous = APIClient()
        self.stranger = APIClient()
        self.stranger.force_authenticate(create_test_user())

    def public_day(self, owner):
        photo = create_test_photo(owner=owner, public=True, exif_timestamp=TAKEN)
        day = create_test_album_date(owner, date=TAKEN.date())
        day.photos.add(photo)
        return day

    def list_status(self, client, **params):
        return client.get("/api/albums/date/list/", {"public": "true", **params})

    def day_status(self, client, day, **params):
        return client.get(f"/api/albums/date/{day.pk}/", {"public": "true", **params})

    def test_no_combined_timeline_without_a_username_whatever_the_gallery(self):
        for stage in ("off", "members", "everyone"):
            for name, client in {
                "anonymous": self.anonymous,
                "signed in": self.stranger,
            }.items():
                with self.subTest(stage=stage, reader=name), gallery(stage):
                    self.assertEqual(self.list_status(client).status_code, 404)
                    for day in self.days.values():
                        self.assertEqual(self.day_status(client, day).status_code, 404)

    def test_a_user_without_a_public_profile_has_no_public_view(self):
        username = self.private.username
        day = self.days[username]
        for client in (self.anonymous, self.stranger):
            self.assertEqual(
                self.list_status(client, username=username).status_code, 404
            )
            self.assertEqual(
                self.day_status(client, day, username=username).status_code, 404
            )
        # Another user's username does not open this user's day either.
        self.assertEqual(
            self.day_status(
                self.anonymous, day, username=self.profile.username
            ).status_code,
            404,
        )

    def test_the_user_themselves_still_reads_their_own_public_days(self):
        me = APIClient()
        me.force_authenticate(self.private)
        response = self.list_status(me, username=self.private.username)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(response.json()["results"]), 1)

    def test_a_public_profile_is_open_to_everyone(self):
        username = self.profile.username
        response = self.list_status(self.anonymous, username=username)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(
            [day["id"] for day in response.json()["results"]], [self.days[username].pk]
        )
        self.assertEqual(
            self.day_status(
                self.anonymous, self.days[username], username=username
            ).status_code,
            200,
        )

    def test_a_deactivated_or_unknown_user_has_no_public_view(self):
        self.profile.is_active = False
        self.profile.save()
        for username in (self.profile.username, "nobody-at-all"):
            with self.subTest(username=username):
                self.assertEqual(
                    self.list_status(self.anonymous, username=username).status_code, 404
                )
