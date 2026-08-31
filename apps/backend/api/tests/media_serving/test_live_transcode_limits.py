"""What the live conversion is allowed to take, and what it does with stderr.

"Always transcode videos" pipes a video the browser cannot decode through
ffmpeg while the viewer watches it. Unbounded, ffmpeg takes every core and
converts as fast as the hardware allows -- so one person opening one video
starves the web UI, the scan workers and every other user -- while playback
needs output only a little faster than real time.

Two limits bound different things, and both matter: -threads (with
-filter_threads, which it does not reach) caps how many cores the work may
occupy, -readrate caps how far ahead of playback it runs.
The third thing covered here is the pipe that made the first two dangerous:
stderr was never read, and rate limiting is precisely what makes a conversion
run long enough to fill it.
"""

import subprocess
from unittest import mock

from django.test import SimpleTestCase, override_settings

from api import ffmpeg_budget
from api.views import views


def _split(command):
    """The options before -i and the options after it, which mean different things."""
    index = command.index("-i")
    return command[:index], command[index + 2 :]


class CpuShareTest(SimpleTestCase):
    def test_takes_the_named_fraction_of_the_machine(self):
        with mock.patch.object(ffmpeg_budget.os, "cpu_count", return_value=8):
            self.assertEqual(ffmpeg_budget.cpu_share(2), 4)
            self.assertEqual(ffmpeg_budget.cpu_share(4), 2)
            self.assertEqual(ffmpeg_budget.cpu_share(1), 8)

    def test_never_reaches_zero_threads(self):
        """A single-core host still has to convert something."""
        with mock.patch.object(ffmpeg_budget.os, "cpu_count", return_value=1):
            self.assertEqual(ffmpeg_budget.cpu_share(2), 1)
            self.assertEqual(ffmpeg_budget.cpu_share(16), 1)

    def test_survives_a_machine_that_will_not_say(self):
        with mock.patch.object(ffmpeg_budget.os, "cpu_count", return_value=None):
            self.assertEqual(ffmpeg_budget.cpu_share(2), 1)

    def test_a_fraction_below_one_means_no_limit_rather_than_a_crash(self):
        """A hand-edited 0 must not take the media endpoint down by dividing."""
        with mock.patch.object(ffmpeg_budget.os, "cpu_count", return_value=8):
            self.assertEqual(ffmpeg_budget.cpu_share(0), 8)
            self.assertEqual(ffmpeg_budget.cpu_share(-4), 8)


class SupportsTest(SimpleTestCase):
    def setUp(self):
        ffmpeg_budget.reset_probe_cache()
        self.addCleanup(ffmpeg_budget.reset_probe_cache)

    def _help(self, text):
        """An ffmpeg on PATH whose help output says ``text``.

        which() is stubbed too: the suite also runs on hosts with no ffmpeg,
        where the probe short-circuits before it would ever ask.
        """
        which = mock.patch.object(
            ffmpeg_budget.shutil, "which", return_value="/usr/bin/ffmpeg"
        )
        which.start()
        self.addCleanup(which.stop)
        return mock.patch.object(
            ffmpeg_budget.subprocess,
            "run",
            return_value=subprocess.CompletedProcess([], 0, stdout=text, stderr=""),
        )

    def test_finds_an_option_that_is_listed(self):
        with self._help("  -readrate speed  read input at specified rate\n"):
            self.assertTrue(ffmpeg_budget.supports("readrate"))

    def test_absent_option_is_not_claimed(self):
        """ffmpeg 4.x has no -readrate, and exits rather than ignoring one."""
        with self._help("  -re  read input at native frame rate\n"):
            self.assertFalse(ffmpeg_budget.supports("readrate"))

    def test_does_not_mistake_a_longer_option_for_a_shorter_one(self):
        """-readrate_initial_burst starts with -readrate and is a different option."""
        with self._help("  -readrate_initial_burst seconds  burst first\n"):
            self.assertFalse(ffmpeg_budget.supports("readrate"))
            self.assertTrue(ffmpeg_budget.supports("readrate_initial_burst"))

    def test_asks_ffmpeg_only_once_however_many_options_are_checked(self):
        """The help text is cached, not each answer, so the second ask is free."""
        with self._help(
            "  -readrate speed  x\n  -readrate_initial_burst seconds  y\n"
        ) as run:
            ffmpeg_budget.supports("readrate")
            ffmpeg_budget.supports("readrate")
            ffmpeg_budget.supports("readrate_initial_burst")
        self.assertEqual(run.call_count, 1)

    def test_no_ffmpeg_on_the_host_is_not_an_exception(self):
        with mock.patch.object(ffmpeg_budget.shutil, "which", return_value=None):
            self.assertFalse(ffmpeg_budget.supports("readrate"))

    def test_an_ffmpeg_that_will_not_answer_is_not_an_exception(self):
        with (
            mock.patch.object(
                ffmpeg_budget.shutil, "which", return_value="/usr/bin/ffmpeg"
            ),
            mock.patch.object(
                ffmpeg_budget.subprocess, "run", side_effect=OSError("boom")
            ),
        ):
            self.assertFalse(ffmpeg_budget.supports("readrate"))


@override_settings(
    TRANSCODE_LIVE_CPU_FRACTION=2,
    TRANSCODE_LIVE_READRATE=2,
    TRANSCODE_LIVE_BURST_SECONDS=30,
)
class BuildLiveCommandTest(SimpleTestCase):
    def setUp(self):
        self.supports = mock.patch.object(
            views.ffmpeg_budget, "supports", return_value=True
        )
        self.supports.start()
        self.addCleanup(self.supports.stop)
        cores = mock.patch.object(ffmpeg_budget.os, "cpu_count", return_value=8)
        cores.start()
        self.addCleanup(cores.stop)

    def test_threads_are_capped_on_both_sides_of_the_input(self):
        """Only after the input caps the encoder and leaves the decode uncapped.

        Measured on a 4-core host converting 1080p to 720p: 2.67 cores
        unbounded, 2.58 with -threads after the input alone, 2.44 with it on
        both sides. See api.ffmpeg_budget for the whole table.
        """
        before, after = _split(views.build_live_command("/x.mp4"))
        self.assertEqual(before[before.index("-threads") + 1], "4")
        self.assertEqual(after[after.index("-threads") + 1], "4")

    def test_the_filter_pool_is_capped_as_well(self):
        """-threads does not reach it: it defaults to one thread per core."""
        before, after = _split(views.build_live_command("/x.mp4"))
        self.assertEqual(before[before.index("-filter_threads") + 1], "4")
        self.assertNotIn("-filter_threads", after)

    def test_the_filter_pool_follows_the_same_fraction(self):
        with override_settings(TRANSCODE_LIVE_CPU_FRACTION=4):
            before, _ = _split(views.build_live_command("/x.mp4"))
        self.assertEqual(before[before.index("-filter_threads") + 1], "2")

    def test_an_ffmpeg_without_filter_threads_still_gets_the_rest(self):
        """Old enough to lack it, and it would exit rather than ignore it."""
        with mock.patch.object(
            views.ffmpeg_budget,
            "supports",
            side_effect=lambda option: option != "filter_threads",
        ):
            command = views.build_live_command("/x.mp4")
        self.assertNotIn("-filter_threads", command)
        self.assertIn("-threads", command)
        self.assertIn("-readrate", command)

    def test_the_fraction_decides_how_many_cores(self):
        with override_settings(TRANSCODE_LIVE_CPU_FRACTION=4):
            before, _ = _split(views.build_live_command("/x.mp4"))
        self.assertEqual(before[before.index("-threads") + 1], "2")

    def test_rate_limit_and_burst_are_input_options(self):
        """They govern how fast the input is read, so after -i they do nothing."""
        before, after = _split(views.build_live_command("/x.mp4"))
        self.assertEqual(float(before[before.index("-readrate") + 1]), 2.0)
        self.assertEqual(
            float(before[before.index("-readrate_initial_burst") + 1]), 30.0
        )
        self.assertNotIn("-readrate", after)

    def test_a_zero_readrate_converts_flat_out(self):
        with override_settings(TRANSCODE_LIVE_READRATE=0):
            command = views.build_live_command("/x.mp4")
        self.assertNotIn("-readrate", command)
        self.assertNotIn("-readrate_initial_burst", command)

    def test_a_zero_burst_still_rate_limits(self):
        with override_settings(TRANSCODE_LIVE_BURST_SECONDS=0):
            command = views.build_live_command("/x.mp4")
        self.assertIn("-readrate", command)
        self.assertNotIn("-readrate_initial_burst", command)

    def test_an_ffmpeg_without_readrate_gets_neither_option(self):
        """Unknown options make ffmpeg exit, which would break every video."""
        with mock.patch.object(views.ffmpeg_budget, "supports", return_value=False):
            command = views.build_live_command("/x.mp4")
        self.assertNotIn("-readrate", command)
        self.assertNotIn("-readrate_initial_burst", command)
        self.assertNotIn("-filter_threads", command)
        self.assertIn("-threads", command)

    def test_an_ffmpeg_with_readrate_but_no_burst_keeps_the_rate_limit(self):
        """ffmpeg 5.x: -readrate exists, -readrate_initial_burst arrived in 6.1."""
        with mock.patch.object(
            views.ffmpeg_budget,
            "supports",
            side_effect=lambda option: option == "readrate",
        ):
            command = views.build_live_command("/x.mp4")
        self.assertIn("-readrate", command)
        self.assertNotIn("-readrate_initial_burst", command)

    def test_progress_output_is_turned_off(self):
        """It is written to a pipe nothing drains; see the stderr tests below."""
        command = views.build_live_command("/x.mp4")
        self.assertEqual(command[command.index("-loglevel") + 1], "error")

    def test_the_height_is_still_a_ceiling_and_not_a_target(self):
        command = views.build_live_command("/x.mp4")
        self.assertIn("scale=-2:'min(720,ih)'", command)

    def test_the_conversion_being_watched_is_not_niced(self):
        """Unlike the cached copy: somebody is waiting for this one."""
        self.assertEqual(views.build_live_command("/x.mp4")[0], "ffmpeg")

    def test_the_path_is_the_input(self):
        command = views.build_live_command("/library/clip.mkv")
        self.assertEqual(command[command.index("-i") + 1], "/library/clip.mkv")
        self.assertEqual(command[-1], "-")


class FakePopen:
    """A process whose stderr must be drained before its stdout will finish.

    This is the shape of the deadlock: ffmpeg blocks writing to a full stderr
    pipe, and stops producing video, so a reader that only reads stdout waits
    forever.
    """

    def __init__(self, stderr_chunks, stdout_lines, returncode=0):
        self._remaining_stderr = list(stderr_chunks)
        self._stdout_lines = list(stdout_lines)
        self.returncode = returncode
        self.stdout = mock.Mock()
        self.stderr = mock.Mock()
        self.stdout.readline = self._readline
        self.stderr.read = self._read_stderr

    def _read_stderr(self, size):
        return self._remaining_stderr.pop(0) if self._remaining_stderr else b""

    def _readline(self):
        # Blocked until stderr has been drained, exactly as a full pipe blocks.
        if self._remaining_stderr:
            return b""
        return self._stdout_lines.pop(0) if self._stdout_lines else b""

    def wait(self, timeout=None):
        return self.returncode

    def kill(self):
        pass


class VideoTranscoderStderrTest(SimpleTestCase):
    def _transcoder(self, process):
        with mock.patch.object(views.subprocess, "Popen", return_value=process):
            return views.VideoTranscoder("/x.mp4")

    def test_stderr_is_drained_so_a_full_pipe_cannot_stall_the_video(self):
        """FakePopen withholds stdout until stderr is read, as a full pipe does."""
        process = FakePopen([b"noise" * 100], [b"frame\n"])
        transcoder = self._transcoder(process)
        transcoder._drain.join(timeout=5)
        self.assertEqual(list(views.gen(transcoder)), [b"frame\n"])

    def test_reading_the_tail_waits_for_the_drain_to_finish(self):
        """A deque may be extended from another thread but not read mid-extend."""
        transcoder = self._transcoder(FakePopen([b"a" * 4096, b"b\n"], []))
        self.assertEqual(transcoder.stderr_tail()[-1], "b")
        self.assertFalse(transcoder._drain.is_alive())

    def test_stderr_is_a_pipe_and_not_discarded(self):
        """Discarding it would be deadlock-free too, and would lose every reason.

        The process is a real fake rather than a bare Mock: the drain thread
        reads until it is handed b"", and a Mock never hands it one.
        """
        with mock.patch.object(
            views.subprocess, "Popen", return_value=FakePopen([], [])
        ) as popen:
            transcoder = views.VideoTranscoder("/x.mp4")
        transcoder._drain.join(timeout=5)
        self.assertEqual(popen.call_args.kwargs["stderr"], subprocess.PIPE)

    def test_what_ffmpeg_said_is_kept(self):
        transcoder = self._transcoder(FakePopen([b"No such file\n"], []))
        self.assertEqual(transcoder.stderr_tail(), "No such file")

    def test_only_the_tail_is_kept_however_much_is_written(self):
        """A file that errors on every frame must not grow this without bound."""
        limit = views.VideoTranscoder.STDERR_TAIL_BYTES
        transcoder = self._transcoder(FakePopen([b"e" * (limit * 3)], []))
        self.assertEqual(len(transcoder.stderr_tail()), limit)


class GenTest(SimpleTestCase):
    def _transcoder(self, process):
        with mock.patch.object(views.subprocess, "Popen", return_value=process):
            return views.VideoTranscoder("/x.mp4")

    def test_a_successful_conversion_says_nothing(self):
        transcoder = self._transcoder(FakePopen([], [b"a\n", b"b\n"]))
        with mock.patch.object(views, "logger") as logger:
            self.assertEqual(list(views.gen(transcoder)), [b"a\n", b"b\n"])
        logger.warning.assert_not_called()

    def test_a_failed_conversion_is_logged_with_the_reason(self):
        """It reaches the browser as a video that stops; the log is the only place left."""
        process = FakePopen([b"Invalid data found\n"], [], returncode=1)
        transcoder = self._transcoder(process)
        with mock.patch.object(views, "logger") as logger:
            list(views.gen(transcoder))
        logger.warning.assert_called_once()
        self.assertIn("Invalid data found", logger.warning.call_args.args[2])
