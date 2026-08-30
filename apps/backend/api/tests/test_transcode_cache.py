"""The disk cache that makes a converted video seekable.

"Always transcode videos" pipes a file the browser cannot decode through
ffmpeg and streams the result as it is produced. That stream has no known
length, so it carries no Content-Length and no Accept-Ranges, and a Range
request against it can only be answered from the beginning -- which is to say
that for anyone with the setting on, no video could be sought at all.

The conversion is therefore also written to a file once, in the background, and
later plays are served from that. These tests cover the two things that makes
that safe: nothing is ever served before it is complete, and the cache stays
inside both of the ceilings it is given.
"""

import os
import shlex
import tempfile
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from api import transcode_cache
from api.views import views
from api.tests.utils import create_test_file, create_test_photo, create_test_user

GB = transcode_cache.BYTES_PER_GB


def _write(path, content=b"x"):
    with open(path, "wb") as handle:
        handle.write(content)
    return path


class CacheDirectoryTestCase(TestCase):
    """A cache in a temporary directory, roomy unless a test says otherwise."""

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = os.path.join(self.directory.name, "transcoded")
        os.makedirs(self.root)
        settings = override_settings(
            TRANSCODE_CACHE_ROOT=self.root,
            TRANSCODE_CACHE_MAX_GB=1,
            TRANSCODE_CACHE_MIN_FREE_GB=0,
            TRANSCODE_CACHE_MAX_CONCURRENT=1,
        )
        settings.enable()
        self.addCleanup(settings.disable)


class EnablementTest(CacheDirectoryTestCase):
    def test_a_size_of_zero_switches_caching_off(self):
        with override_settings(TRANSCODE_CACHE_MAX_GB=0):
            self.assertFalse(transcode_cache.is_enabled())

    def test_it_is_on_when_it_has_somewhere_to_write_and_room_to_write(self):
        self.assertTrue(transcode_cache.is_enabled())


class LookupTest(CacheDirectoryTestCase):
    def setUp(self):
        super().setUp()
        self.photo = create_test_photo(owner=create_test_user(), video=True)

    def test_nothing_cached_yet(self):
        self.assertIsNone(transcode_cache.cached_path(self.photo))

    def test_a_finished_file_is_found(self):
        path = _write(transcode_cache.final_path(self.photo.image_hash))
        self.assertEqual(transcode_cache.cached_path(self.photo), path)

    def test_a_conversion_still_running_is_not_served(self):
        # The part-file is the work in progress. Serving it would hand out a
        # video that plays half way and stops.
        _write(transcode_cache.final_path(self.photo.image_hash) + ".part")
        self.assertIsNone(transcode_cache.cached_path(self.photo))

    def test_serving_marks_the_file_as_recently_used(self):
        # mtime is the only ordering the eviction has: access times cannot be
        # relied on, since plenty of volumes are mounted noatime or relatime.
        path = _write(transcode_cache.final_path(self.photo.image_hash))
        os.utime(path, (1000, 1000))
        transcode_cache.cached_path(self.photo)
        self.assertGreater(os.stat(path).st_mtime, 1000)

    def test_a_disabled_cache_never_reports_a_hit(self):
        _write(transcode_cache.final_path(self.photo.image_hash))
        with override_settings(TRANSCODE_CACHE_MAX_GB=0):
            self.assertIsNone(transcode_cache.cached_path(self.photo))


class EstimateTest(CacheDirectoryTestCase):
    def test_the_estimate_follows_the_recorded_duration(self):
        owner = create_test_user()
        short = create_test_photo(owner=owner, video=True, video_length="60")
        long = create_test_photo(owner=owner, video=True, video_length="600")
        self.assertAlmostEqual(
            transcode_cache.estimated_size(long),
            transcode_cache.estimated_size(short) * 10,
            delta=10,
        )

    def test_a_video_of_unknown_length_is_still_worth_starting(self):
        photo = create_test_photo(owner=create_test_user(), video=True)
        photo.video_length = None
        self.assertGreater(transcode_cache.estimated_size(photo), 0)


class CommandTest(CacheDirectoryTestCase):
    def test_the_height_is_a_ceiling_rather_than_a_target(self):
        # "scale=-2:720" enlarges anything shorter, which is most phone footage
        # and exactly the material that needs converting.
        command = transcode_cache.build_command("/in.mkv", "/out.part")
        self.assertIn("scale=-2:'min(720,ih)'", command)

    def test_the_cached_copy_is_encoded_more_carefully_than_the_live_one(self):
        # Nothing is waiting on this conversion, and ultrafast costs roughly
        # double the bytes for the same picture.
        command = transcode_cache.build_command("/in.mkv", "/out.part")
        self.assertIn("veryfast", command)
        self.assertNotIn("ultrafast", command)

    def test_the_result_is_laid_out_for_playing_over_http(self):
        command = transcode_cache.build_command("/in.mkv", "/out.part")
        self.assertIn("+faststart", command)

    def test_it_stands_back_from_whatever_else_the_server_is_doing(self):
        # Nobody is waiting for this conversion, so it must not take the machine
        # away from playback, thumbnails or a scan.
        command = transcode_cache.build_command("/in.mkv", "/out.part")
        self.assertIn("nice", command[0])
        self.assertEqual(command[1:3], ["-n", "10"])

    def test_the_encoder_is_capped_at_half_the_cores(self):
        # ffmpeg takes every core by default. The flag has to sit after the
        # input, or it limits decoding rather than encoding.
        command = transcode_cache.build_command("/in.mkv", "/out.part")
        threads = command.index("-threads")
        self.assertGreater(threads, command.index("/in.mkv"))
        self.assertEqual(command[threads + 1], str(max(1, (os.cpu_count() or 2) // 2)))


class MakeRoomTest(CacheDirectoryTestCase):
    def test_the_least_recently_served_go_first(self):
        old = _write(os.path.join(self.root, "old.mp4"), b"a" * 1000)
        recent = _write(os.path.join(self.root, "recent.mp4"), b"b" * 1000)
        os.utime(old, (1000, 1000))
        os.utime(recent, (2000, 2000))

        # Two 1000-byte entries in a 2500-byte cache: making room for another
        # 1000 costs exactly one of them, and it should be the older.
        with override_settings(TRANSCODE_CACHE_MAX_GB=2500 / GB):
            self.assertTrue(transcode_cache.make_room(self.root, 1000))

        self.assertFalse(os.path.exists(old))
        self.assertTrue(os.path.exists(recent))

    def test_a_conversion_in_progress_is_never_evicted(self):
        part = _write(os.path.join(self.root, "busy.mp4.part"), b"a" * 1000)
        with override_settings(TRANSCODE_CACHE_MAX_GB=500 / GB):
            transcode_cache.make_room(self.root, 400)
        self.assertTrue(os.path.exists(part))

    def test_it_gives_up_rather_than_emptying_the_cache_for_nothing(self):
        _write(os.path.join(self.root, "kept.mp4"), b"a" * 100)
        with override_settings(TRANSCODE_CACHE_MAX_GB=1000 / GB):
            self.assertFalse(transcode_cache.make_room(self.root, 5000))

    def test_the_free_space_floor_is_respected_even_with_room_in_the_budget(self):
        # The volume holds the thumbnails and, in the default layout, the
        # database. Filling it is a worse outcome than converting again.
        with override_settings(TRANSCODE_CACHE_MIN_FREE_GB=1):
            with mock.patch.object(
                transcode_cache, "free_bytes", return_value=GB + 1000
            ):
                self.assertFalse(transcode_cache.make_room(self.root, 5000))
                self.assertTrue(transcode_cache.make_room(self.root, 500))


class StalePartTest(CacheDirectoryTestCase):
    def test_an_abandoned_conversion_stops_blocking_its_video(self):
        # The part-file is how the claim is held across worker processes, so a
        # worker killed mid-conversion would otherwise make that one video
        # uncacheable forever.
        stale = _write(os.path.join(self.root, "stale.mp4.part"))
        fresh = _write(os.path.join(self.root, "fresh.mp4.part"))
        os.utime(stale, (1000, 1000))

        transcode_cache._drop_stale_parts(self.root)

        self.assertFalse(os.path.exists(stale))
        self.assertTrue(os.path.exists(fresh))


class RunTranscodeTest(CacheDirectoryTestCase):
    def setUp(self):
        super().setUp()
        self.final = os.path.join(self.root, "clip.mp4")
        self.part = self.final + ".part"

    def _command(self, script):
        return ["sh", "-c", script.format(part=shlex.quote(self.part))]

    def test_a_finished_conversion_is_published_under_its_real_name(self):
        self.assertTrue(
            transcode_cache.run_transcode(
                self._command("printf video > {part}"), self.part, self.final
            )
        )
        self.assertFalse(os.path.exists(self.part))
        with open(self.final, "rb") as handle:
            self.assertEqual(handle.read(), b"video")

    def test_a_failed_conversion_leaves_nothing_behind(self):
        # Publishing on failure is the one thing that must never happen: a
        # truncated file would play part way through and stop, for good.
        self.assertFalse(
            transcode_cache.run_transcode(
                self._command("printf half > {part}; exit 3"), self.part, self.final
            )
        )
        self.assertFalse(os.path.exists(self.final))
        self.assertFalse(os.path.exists(self.part))

    def test_an_empty_result_is_not_published(self):
        self.assertFalse(
            transcode_cache.run_transcode(self._command("true"), self.part, self.final)
        )
        self.assertFalse(os.path.exists(self.final))

    def test_a_command_that_cannot_even_start_is_survived(self):
        _write(self.part)
        self.assertFalse(
            transcode_cache.run_transcode(
                ["/nonexistent/ffmpeg"], self.part, self.final
            )
        )
        self.assertFalse(os.path.exists(self.part))


class EnsureCachedTest(CacheDirectoryTestCase):
    def setUp(self):
        super().setUp()
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user, video=True, video_length="10")
        source = _write(os.path.join(self.directory.name, "source.mkv"), b"source")
        self.photo.main_file = create_test_file(source, self.user, b"source")
        self.photo.save()
        self.started = []

    def _start(self, command, part, final, root):
        self.started.append((command, part, final))

    def test_it_claims_the_work_and_starts_a_conversion(self):
        self.assertTrue(transcode_cache.ensure_cached(self.photo, start=self._start))
        self.assertEqual(len(self.started), 1)
        self.assertTrue(os.path.exists(self.started[0][1]))

    def test_a_second_request_does_not_start_a_second_conversion(self):
        # The part-file is created with O_EXCL, which is the only claim that
        # holds across the several worker processes the backend runs.
        transcode_cache.ensure_cached(self.photo, start=self._start)
        self.assertFalse(transcode_cache.ensure_cached(self.photo, start=self._start))
        self.assertEqual(len(self.started), 1)

    def test_an_already_cached_video_is_left_alone(self):
        _write(transcode_cache.final_path(self.photo.image_hash))
        self.assertFalse(transcode_cache.ensure_cached(self.photo, start=self._start))

    def test_only_so_many_conversions_run_at_once(self):
        _write(os.path.join(self.root, "someone-else.mp4.part"))
        self.assertFalse(transcode_cache.ensure_cached(self.photo, start=self._start))

    def test_a_full_disk_declines_the_work_instead_of_failing(self):
        with override_settings(TRANSCODE_CACHE_MIN_FREE_GB=1):
            with mock.patch.object(transcode_cache, "free_bytes", return_value=1000):
                self.assertFalse(
                    transcode_cache.ensure_cached(self.photo, start=self._start)
                )
        # And no claim is left behind to block a later, roomier attempt.
        self.assertEqual(os.listdir(self.root), [])

    def test_caching_switched_off_does_nothing_at_all(self):
        with override_settings(TRANSCODE_CACHE_MAX_GB=0):
            self.assertFalse(
                transcode_cache.ensure_cached(self.photo, start=self._start)
            )
        self.assertEqual(self.started, [])

    def test_a_photo_with_no_file_is_not_attempted(self):
        self.photo.main_file = None
        self.assertFalse(transcode_cache.ensure_cached(self.photo, start=self._start))


class DiscardTest(CacheDirectoryTestCase):
    def test_deleting_a_photo_takes_its_cached_copy_with_it(self):
        user = create_test_user()
        photo = create_test_photo(owner=user, video=True)
        final = _write(transcode_cache.final_path(photo.image_hash))
        part = _write(final + ".part")

        photo.manual_delete()

        self.assertFalse(os.path.exists(final))
        self.assertFalse(os.path.exists(part))


@override_settings(SERVE_FRONTEND=True)
class ServingACachedTranscodeTest(CacheDirectoryTestCase):
    """What the media endpoint does once a seekable copy exists."""

    def setUp(self):
        super().setUp()
        self.user = create_test_user()
        self.user.transcode_videos = True
        self.user.save()
        self.photo = create_test_photo(owner=self.user, video=True)
        source = _write(os.path.join(self.directory.name, "source.mkv"), b"source")
        self.photo.main_file = create_test_file(source, self.user, b"source")
        self.photo.save()
        self.client = APIClient()
        self.client.cookies["jwt"] = str(RefreshToken.for_user(self.user).access_token)

    def test_the_file_is_served_instead_of_a_conversion_being_started(self):
        _write(transcode_cache.final_path(self.photo.image_hash), b"cached mp4")

        with mock.patch.object(views, "VideoTranscoder") as transcoder:
            response = self.client.get(f"/media/photos/{self.photo.image_hash}")

        transcoder.assert_not_called()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response["Accept-Ranges"], "bytes")
        response.close()

    def test_the_cached_copy_can_be_sought(self):
        # The whole point: a live conversion has no length and no ranges, so
        # until there is a file there is no seeking.
        _write(transcode_cache.final_path(self.photo.image_hash), b"0123456789")

        with mock.patch.object(views, "VideoTranscoder"):
            response = self.client.get(
                f"/media/photos/{self.photo.image_hash}", HTTP_RANGE="bytes=4-6"
            )

        self.assertEqual(response.status_code, 206)
        self.assertEqual(response["Content-Range"], "bytes 4-6/10")
        self.assertEqual(b"".join(response.streaming_content), b"456")

    @override_settings(SERVE_FRONTEND=False)
    def test_behind_the_proxy_the_web_server_is_handed_the_file(self):
        # nginx answers ranges by itself, so the redirect is all that is needed
        # for seeking to work there.
        with override_settings(MEDIA_ROOT=self.directory.name):
            _write(transcode_cache.final_path(self.photo.image_hash), b"cached mp4")

            with mock.patch.object(views, "VideoTranscoder") as transcoder:
                response = self.client.get(f"/media/photos/{self.photo.image_hash}")

        transcoder.assert_not_called()
        self.assertEqual(
            response["X-Accel-Redirect"],
            f"/protected_media/transcoded/{self.photo.image_hash}.mp4",
        )
        self.assertEqual(response["Content-Type"], "video/mp4")

    def test_the_first_play_still_streams_live(self):
        with (
            mock.patch.object(views, "VideoTranscoder"),
            mock.patch.object(views.transcode_cache, "ensure_cached"),
            mock.patch.object(views, "gen", return_value=iter([b"live"])),
        ):
            response = self.client.get(f"/media/photos/{self.photo.image_hash}")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(response["Content-Type"], "video/mp4")
            # Both answer to the same URL, and this is the poorer of the two: a
            # browser that kept it would go on serving an unseekable video
            # after a seekable one exists.
            self.assertEqual(response["Cache-Control"], "no-store")
            self.assertEqual(b"".join(response.streaming_content), b"live")

    def test_the_copy_is_written_after_the_live_stream_and_not_beside_it(self):
        # The live conversion has to keep ahead of playback. A second ffmpeg
        # started next to it takes a share of the machine away from the one
        # thing somebody is waiting for -- on two cores, half of it, which is
        # enough to make a video that used to start at once look stuck.
        with (
            mock.patch.object(views, "VideoTranscoder"),
            mock.patch.object(views.transcode_cache, "ensure_cached") as ensure_cached,
            mock.patch.object(views, "gen", return_value=iter([b"x"])),
        ):
            response = self.client.get(f"/media/photos/{self.photo.image_hash}")

            ensure_cached.assert_not_called()
            b"".join(response.streaming_content)
            ensure_cached.assert_called_once()

    def test_a_viewer_who_leaves_early_still_gets_a_copy_written(self):
        # Closing the response closes the generator, so the copy is asked for
        # whether the video ran to the end or the tab was shut after a second.
        with (
            mock.patch.object(views, "VideoTranscoder"),
            mock.patch.object(views.transcode_cache, "ensure_cached") as ensure_cached,
            mock.patch.object(views, "gen", return_value=iter([b"a", b"b", b"c"])),
        ):
            response = self.client.get(f"/media/photos/{self.photo.image_hash}")

            next(response.streaming_content)
            ensure_cached.assert_not_called()
            response.close()
            ensure_cached.assert_called_once()
