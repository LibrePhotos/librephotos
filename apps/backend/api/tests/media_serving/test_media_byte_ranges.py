"""Byte ranges for files the backend serves itself.

An install running behind the bundled proxy never gets here for media bytes --
nginx answers ranges itself once the backend hands off with X-Accel-Redirect.
An install serving media from Django had no such help: every response arrived
whole, from the first byte, without so much as an ``Accept-Ranges`` header, so
no video in one of those installs could be sought at all.
"""

import os
import tempfile

from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from api.http_range import UNSATISFIABLE, parse_byte_range, ranged_response
from api.tests.utils import create_test_file, create_test_photo, create_test_user

CONTENT = bytes(range(256)) * 8  # 2048 bytes, every one of them distinguishable


class ParseByteRangeTest(TestCase):
    def test_no_header_means_the_whole_file(self):
        self.assertIsNone(parse_byte_range(None, 100))
        self.assertIsNone(parse_byte_range("", 100))

    def test_a_closed_range(self):
        self.assertEqual(parse_byte_range("bytes=10-19", 100), (10, 19))

    def test_an_open_range_runs_to_the_end(self):
        self.assertEqual(parse_byte_range("bytes=90-", 100), (90, 99))

    def test_a_suffix_range_counts_back_from_the_end(self):
        # How a player finds the index of an mp4 that was not laid out for
        # streaming: ask for the last few kilobytes.
        self.assertEqual(parse_byte_range("bytes=-10", 100), (90, 99))

    def test_a_suffix_longer_than_the_file_is_the_whole_file(self):
        self.assertEqual(parse_byte_range("bytes=-500", 100), (0, 99))

    def test_an_end_past_the_file_is_clamped(self):
        self.assertEqual(parse_byte_range("bytes=50-999", 100), (50, 99))

    def test_a_start_past_the_file_cannot_be_satisfied(self):
        self.assertIs(parse_byte_range("bytes=100-", 100), UNSATISFIABLE)
        self.assertIs(parse_byte_range("bytes=150-160", 100), UNSATISFIABLE)

    def test_a_backwards_range_cannot_be_satisfied(self):
        self.assertIs(parse_byte_range("bytes=50-10", 100), UNSATISFIABLE)

    def test_syntax_we_do_not_speak_falls_back_to_the_whole_file(self):
        # Answering with the complete file is always allowed, and is a great
        # deal friendlier than a 416 at something merely unfamiliar.
        self.assertIsNone(parse_byte_range("items=0-10", 100))
        self.assertIsNone(parse_byte_range("bytes=abc", 100))
        self.assertIsNone(parse_byte_range("bytes=0-10, 20-30", 100))
        self.assertIsNone(parse_byte_range("bytes=-", 100))

    def test_an_empty_file_has_no_ranges(self):
        self.assertIsNone(parse_byte_range("bytes=0-10", 0))


class RangedResponseTest(TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = os.path.join(self.directory.name, "clip.mp4")
        with open(self.path, "wb") as handle:
            handle.write(CONTENT)

    def _serve(self, header):
        handle = open(self.path, "rb")
        return ranged_response(handle, len(CONTENT), header, "video/mp4")

    def test_a_whole_file_still_advertises_ranges(self):
        response = self._serve(None)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Accept-Ranges"], "bytes")
        self.assertEqual(response["Content-Type"], "video/mp4")
        response.close()

    def test_a_range_is_answered_with_exactly_those_bytes(self):
        response = self._serve("bytes=100-199")
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response["Content-Range"], f"bytes 100-199/{len(CONTENT)}")
        self.assertEqual(response["Content-Length"], "100")
        self.assertEqual(b"".join(response.streaming_content), CONTENT[100:200])

    def test_an_open_range_runs_to_the_last_byte(self):
        response = self._serve("bytes=2040-")
        self.assertEqual(response.status_code, 206)
        self.assertEqual(b"".join(response.streaming_content), CONTENT[2040:])

    def test_a_range_larger_than_one_chunk_arrives_intact(self):
        # The reader hands out 64 KiB at a time; a range has to survive being
        # cut into pieces without gaining or losing a byte.
        big = os.path.join(self.directory.name, "big.mp4")
        payload = CONTENT * 100  # 200 KiB
        with open(big, "wb") as handle:
            handle.write(payload)
        response = ranged_response(open(big, "rb"), len(payload), "bytes=1-199999")
        self.assertEqual(b"".join(response.streaming_content), payload[1:200000])

    def test_an_impossible_range_is_refused_rather_than_answered(self):
        response = self._serve("bytes=9999-")
        self.assertEqual(response.status_code, 416)
        self.assertEqual(response["Content-Range"], f"bytes */{len(CONTENT)}")


@override_settings(SERVE_FRONTEND=True)
class ServeFileDirectRangeTest(TestCase):
    """The same thing, reached the way a browser reaches it."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.user = create_test_user()
        path = os.path.join(self.directory.name, "clip.mp4")
        file = create_test_file(path, self.user, CONTENT)
        self.photo = create_test_photo(owner=self.user, video=True)
        # create_test_photo supplies a main_file of its own, so the real one has
        # to be put in place afterwards.
        self.photo.main_file = file
        self.photo.save()
        self.photo.files.add(file)
        self.client = APIClient()
        self.client.cookies["jwt"] = str(RefreshToken.for_user(self.user).access_token)

    def test_seeking_a_video_gets_the_part_that_was_asked_for(self):
        response = self.client.get(
            f"/media/photos/{self.photo.image_hash}", HTTP_RANGE="bytes=64-127"
        )
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response["Content-Range"], f"bytes 64-127/{len(CONTENT)}")
        self.assertEqual(b"".join(response.streaming_content), CONTENT[64:128])

    def test_a_plain_request_says_that_seeking_is_possible(self):
        response = self.client.get(f"/media/photos/{self.photo.image_hash}")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Accept-Ranges"], "bytes")
        response.close()
