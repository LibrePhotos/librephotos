"""Converting only the videos this browser cannot play.

"Always transcode videos" was the only way to play an HEVC clip in a browser
that does not decode HEVC, and it converted everything, including the H.264
videos that play as they are -- at a 720-line cap, in a browser that may well
have played the original in 4K. The backend now tells the frontend what each
video is, in the form ``canPlayType`` takes (:mod:`api.video_playback`), and
the frontend asks for a conversion with ``?transcode=1`` only when the answer
is no.

Covered here: the type string for the formats phones and cameras actually
produce, the serializer field, and which requests ``?transcode=1`` converts.
"""

import os
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from api import transcode_cache, video_playback
from api.models import AlbumUser, Photo
from api.models.album_user_share import AlbumUserShare
from api.serializers.photos import PhotoSerializer
from api.tests.media_serving.test_issue_477_video_transcode_on_photos_path import (
    MP4_BYTES,
    FakeVideoTranscoder,
)
from api.tests.utils import create_test_file, create_test_photo, create_test_user

MP4 = "mov,mp4,m4a,3gp,3g2,mj2"
MKV = "matroska,webm"


def _type(codec, pixel_format="yuv420p", container=MP4, video=True):
    return video_playback.playback_type(
        SimpleNamespace(
            video=video,
            video_codec=codec,
            video_pixel_format=pixel_format,
            video_container=container,
        )
    )


class PlaybackTypeTest(SimpleTestCase):
    def test_ordinary_phone_h264_is_the_high_profile_everything_plays(self):
        self.assertEqual(_type("h264"), 'video/mp4; codecs="avc1.640028"')
        self.assertEqual(_type("h264", "yuvj420p"), 'video/mp4; codecs="avc1.640028"')

    def test_10_bit_h264_is_high_10_which_browsers_refuse(self):
        self.assertEqual(
            _type("h264", "yuv420p10le"), 'video/mp4; codecs="avc1.6E0028"'
        )

    def test_4_2_2_camera_footage_is_its_own_profile(self):
        self.assertEqual(_type("h264", "yuv422p"), 'video/mp4; codecs="avc1.7A0028"')
        self.assertEqual(
            _type("hevc", "yuv422p10le"), 'video/mp4; codecs="hvc1.4.10.L120.90"'
        )

    def test_hevc_main_and_main_10_are_told_apart(self):
        """Every recent iPhone and most Android phones record Main 10."""
        self.assertEqual(_type("hevc"), 'video/mp4; codecs="hvc1.1.6.L120.90"')
        self.assertEqual(
            _type("hevc", "yuv420p10le"), 'video/mp4; codecs="hvc1.2.4.L120.90"'
        )
        self.assertEqual(
            _type("hevc", "p010le"), 'video/mp4; codecs="hvc1.2.4.L120.90"'
        )

    def test_webm_codecs_in_matroska_are_asked_about_as_webm(self):
        self.assertEqual(
            _type("vp9", container=MKV), 'video/webm; codecs="vp09.00.40.08"'
        )
        self.assertEqual(_type("vp8", container=MKV), 'video/webm; codecs="vp8"')
        self.assertEqual(
            _type("av1", "yuv420p10le", MKV), 'video/webm; codecs="av01.0.08M.10"'
        )

    def test_other_codecs_in_matroska_are_asked_about_as_matroska(self):
        self.assertEqual(
            _type("h264", container=MKV), 'video/x-matroska; codecs="avc1.640028"'
        )

    def test_old_camera_formats_are_named_so_the_browser_says_no(self):
        self.assertEqual(_type("mpeg4"), 'video/mp4; codecs="mp4v.20.9"')
        self.assertEqual(_type("prores", "yuv422p10le"), 'video/mp4; codecs="prores"')
        self.assertEqual(
            _type("mpeg2video", container="mpegts"),
            'video/mp2t; codecs="mpeg2video"',
        )
        self.assertEqual(_type("mjpeg", "yuvj422p", "avi"), 'video/avi; codecs="mjpeg"')

    def test_nothing_to_say_about_an_unprobed_video_or_a_photo(self):
        """The frontend then plays the original, and falls back if it fails."""
        self.assertIsNone(_type(None))
        self.assertIsNone(_type(""))
        self.assertIsNone(_type("h264", video=False))

    def test_a_missing_pixel_format_is_read_as_the_common_one(self):
        self.assertEqual(_type("h264", ""), 'video/mp4; codecs="avc1.640028"')
        self.assertEqual(_type("h264", None), 'video/mp4; codecs="avc1.640028"')


class SerializerFieldTest(TestCase):
    def test_the_photo_detail_carries_the_type(self):
        photo = create_test_photo(owner=create_test_user(), video=True)
        Photo.objects.filter(pk=photo.pk).update(
            video_codec="hevc", video_pixel_format="yuv420p10le", video_container=MP4
        )
        data = PhotoSerializer(Photo.objects.get(pk=photo.pk)).data
        self.assertEqual(
            data["video_playback_type"], 'video/mp4; codecs="hvc1.2.4.L120.90"'
        )

    def test_a_photo_carries_none(self):
        photo = create_test_photo(owner=create_test_user())
        self.assertIsNone(PhotoSerializer(photo).data["video_playback_type"])


class TranscodeOnRequestTest(TestCase):
    def setUp(self):
        self.owner = create_test_user()
        self.photo = create_test_photo(owner=self.owner, video=True)
        path = f"/tmp/{self.photo.image_hash}.mp4"
        self.photo.main_file = create_test_file(path, self.owner, MP4_BYTES)
        self.photo.save()
        self.addCleanup(lambda: os.path.exists(path) and os.remove(path))
        self.url = f"/media/photos/{self.photo.image_hash}.mp4"

    def _get(self, user=None, query="", method="get"):
        client = APIClient()
        if user is not None:
            client.cookies["jwt"] = str(AccessToken.for_user(user))
        with patch(
            "api.views.media.VideoTranscoder", side_effect=FakeVideoTranscoder
        ) as transcoder:
            response = getattr(client, method)(self.url + query)
        return response, transcoder.called

    def _public_album(self):
        album = AlbumUser.objects.create(title="Open", owner=self.owner)
        album.photos.add(self.photo)
        AlbumUserShare.objects.create(album=album, enabled=True)

    def test_asked_for_it_the_owner_gets_a_conversion(self):
        response, converted = self._get(self.owner, "?transcode=1")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(converted)
        self.assertEqual(response["Content-Type"], "video/mp4")

    def test_not_asked_the_original_is_served_as_before(self):
        response, converted = self._get(self.owner)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(converted)

    def test_only_the_exact_value_asks(self):
        _, converted = self._get(self.owner, "?transcode=0")
        self.assertFalse(converted)

    def test_a_share_recipient_can_ask_too(self):
        friend = create_test_user()
        self.photo.shared_to.add(friend)
        _, converted = self._get(friend, "?transcode=1")
        self.assertTrue(converted)

    def test_always_transcode_still_converts_without_asking(self):
        self.owner.transcode_videos = True
        self.owner.save()
        _, converted = self._get(self.owner)
        self.assertTrue(converted)

    def test_an_anonymous_public_album_viewer_cannot_make_the_server_convert(self):
        self._public_album()
        response, converted = self._get(query="?transcode=1")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(converted)

    def test_the_owner_still_gets_it_for_a_video_in_a_public_album(self):
        """The public album used to answer first, for everyone, unconverted."""
        self._public_album()
        _, converted = self._get(self.owner, "?transcode=1")
        self.assertTrue(converted)

    def test_a_head_request_does_not_start_a_conversion(self):
        """The lightbox's failure probe asks for the status only."""
        with patch.object(transcode_cache, "ensure_cached") as ensure_cached:
            response, converted = self._get(self.owner, "?transcode=1", "head")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Content-Type"], "video/mp4")
        self.assertFalse(converted)
        ensure_cached.assert_not_called()

    def test_a_signed_in_viewer_of_a_public_album_can_ask(self):
        """Any user may already convert their own videos, so this grants nothing."""
        self._public_album()
        response, converted = self._get(create_test_user(), "?transcode=1")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(converted)

    def test_a_stranger_is_still_refused(self):
        response, converted = self._get(create_test_user(), "?transcode=1")
        self.assertEqual(response.status_code, 404)
        self.assertFalse(converted)
