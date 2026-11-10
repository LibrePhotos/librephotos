"""An album's public link closes at its ``expires_at`` everywhere at once.

An expired link keeps ``enabled`` and its slug, so the owner can give it a new
date; whether it is live was worked out again by each reader (the album by
slug, a photo of it, the album API's public read, the media views and
``AlbumUserShare.is_active``). They all ask ``AlbumUserShare.active_q`` now.
"""

import datetime
from unittest import mock

from django.test import TestCase
from rest_framework.test import APIClient

from api.models import AlbumUserShare
from api.tests.utils import create_test_album_user, create_test_photo, create_test_user

NOW = datetime.datetime(2026, 11, 10, 12, 0, tzinfo=datetime.UTC)


class AlbumShareExpiryTest(TestCase):
    def setUp(self):
        owner = create_test_user()
        self.photo = create_test_photo(owner=owner)
        self.album = create_test_album_user(title="Trip", owner=owner)
        self.album.photos.add(self.photo)
        self.share = AlbumUserShare.objects.create(album=self.album, enabled=True)
        self.client = APIClient()
        patcher = mock.patch("django.utils.timezone.now", return_value=NOW)
        patcher.start()
        self.addCleanup(patcher.stop)

    def expire_at(self, when):
        AlbumUserShare.objects.filter(pk=self.share.pk).update(expires_at=when)
        self.share.refresh_from_db()

    def readers(self):
        slug = self.share.slug
        return {
            "album": self.client.get(f"/api/public/albums/s/{slug}/").status_code,
            "photo": self.client.get(
                f"/api/public/albums/s/{slug}/photos/{self.photo.pk}/"
            ).status_code,
            "album_api": self.client.get(
                f"/api/albums/user/{self.album.pk}/", {"public": "true", "slug": slug}
            ).status_code,
            "media": self.client.get(
                f"/media/thumbnails_big/{self.photo.image_hash}"
            ).status_code,
            "is_active": self.share.is_active(),
        }

    def test_a_link_is_open_up_to_its_expiry(self):
        self.expire_at(NOW)
        self.assertEqual(
            self.readers(),
            {
                "album": 200,
                "photo": 200,
                "album_api": 200,
                "media": 200,
                "is_active": True,
            },
        )

    def test_a_link_is_closed_everywhere_once_it_expired(self):
        self.expire_at(NOW - datetime.timedelta(microseconds=1))
        readers = self.readers()
        self.assertFalse(readers.pop("is_active"))
        self.assertTrue(
            all(status in (403, 404) for status in readers.values()), readers
        )

    def test_the_filter_and_the_flag_agree(self):
        for delta in (-1, 0, 1):
            self.expire_at(NOW + datetime.timedelta(microseconds=delta))
            self.assertEqual(
                AlbumUserShare.objects.filter(
                    AlbumUserShare.active_q(), pk=self.share.pk
                ).exists(),
                self.share.is_active(),
                delta,
            )
