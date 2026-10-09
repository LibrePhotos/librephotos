"""What the events page needs from the event endpoints to lay photos out.

The event list's ``timestamp`` is a grouping key 11h59m before the first photo,
so a card dated with it showed a morning event on the day before; ``start`` is
the first photo's own time. The event detail's photos lacked what every other
grid gets, so a 2400x800 photo was cropped to a square with no placeholder
colour and no duration or HDR badge.
"""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.test import APIClient

from api.models import AlbumAuto
from api.tests.utils import create_test_photo, create_test_user


class AlbumAutoGridFieldsTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.first = timezone.now().replace(microsecond=0) - timedelta(days=3)

    def _event(self, *photos):
        album = AlbumAuto.objects.create(
            title="Sunday",
            owner=self.user,
            timestamp=self.first - timedelta(hours=11, minutes=59),
            created_on=timezone.now(),
        )
        album.photos.add(*photos)
        return album

    def _card(self, album):
        results = self.client.get("/api/albums/auto/list/").json()["results"]
        return next(row for row in results if row["id"] == album.id)

    def test_the_card_starts_at_the_first_shown_photo(self):
        # Earlier, but hidden: the event shows it nowhere, so it does not start it.
        hidden = create_test_photo(
            owner=self.user, hidden=True, exif_timestamp=self.first - timedelta(days=1)
        )
        first = create_test_photo(owner=self.user, exif_timestamp=self.first)
        later = create_test_photo(
            owner=self.user, exif_timestamp=self.first + timedelta(hours=5)
        )
        album = self._event(hidden, first, later)

        card = self._card(album)

        self.assertEqual(self.first, parse_datetime(card["start"]))

    def test_the_photos_carry_what_a_grid_tile_needs(self):
        wide = create_test_photo(
            owner=self.user,
            exif_timestamp=self.first,
            aspect_ratio=3.0,
            dominant_color="[145, 83, 48]",
        )
        video = create_test_photo(
            owner=self.user,
            exif_timestamp=self.first + timedelta(minutes=1),
            video=True,
            video_length="12.5",
            video_color_transfer="smpte2084",
        )
        album = self._event(wide, video)

        photos = self.client.get(f"/api/albums/auto/{album.id}/").json()["photos"]
        by_hash = {photo["image_hash"]: photo for photo in photos}

        self.assertEqual(3.0, by_hash[wide.image_hash]["aspectRatio"])
        self.assertEqual("#915330", by_hash[wide.image_hash]["dominantColor"])
        self.assertEqual("", by_hash[wide.image_hash]["video_length"])
        self.assertIs(False, by_hash[wide.image_hash]["is_hdr"])
        self.assertEqual("", by_hash[video.image_hash]["dominantColor"])
        self.assertEqual("12.5", by_hash[video.image_hash]["video_length"])
        self.assertIs(True, by_hash[video.image_hash]["is_hdr"])
