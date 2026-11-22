import subprocess
from contextlib import ExitStack
from pathlib import Path
from unittest import mock

from django.test import SimpleTestCase, override_settings

from api.sharing import copies
from api.thumbnails import render
from api.video import ffmpeg_budget, transcode_cache
from api.views import media
from scripts.ffmpeg import compat

SOURCE = Path("/library/clip.mov")
TRANSFERS = ("", "bt709", "smpte2084", "arib-std-b67")


def _ran():
    return subprocess.CompletedProcess([], 0, b"", b"")


@override_settings(
    TRANSCODE_LIVE_READRATE=float(compat.LIVE_READRATE),
    TRANSCODE_LIVE_BURST_SECONDS=float(compat.LIVE_BURST_SECONDS),
    TRANSCODE_CACHE_NICE=0,
    TRANSCODE_CACHE_PRESET=compat.CACHED_PRESET,
    VIDEO_PREVIEW_SECONDS=compat.PREVIEW_SECONDS,
    VIDEO_PREVIEW_CRF=compat.PREVIEW_CRF,
)
class CompatMirrorsTheBackendCommandsTest(SimpleTestCase):
    def setUp(self):
        stack = ExitStack()
        self.addCleanup(stack.close)
        stack.enter_context(
            mock.patch.object(ffmpeg_budget, "supports", return_value=True)
        )
        stack.enter_context(
            mock.patch.object(ffmpeg_budget, "supports_filter", return_value=True)
        )
        stack.enter_context(
            mock.patch.object(
                ffmpeg_budget, "cpu_share", return_value=int(compat.LIVE_THREADS)
            )
        )
        stack.enter_context(
            mock.patch.object(
                transcode_cache,
                "_background_threads",
                return_value=int(compat.CACHED_THREADS),
            )
        )

    def test_live_conversion(self):
        for transfer in TRANSFERS:
            with self.subTest(transfer=transfer):
                self.assertEqual(
                    media.build_live_command(str(SOURCE), transfer)[1:],
                    compat.live_args(SOURCE, transfer),
                )

    def test_cached_conversion(self):
        destination = Path("/cache/clip.mp4")
        for transfer in TRANSFERS:
            with self.subTest(transfer=transfer):
                self.assertEqual(
                    transcode_cache.build_command(
                        str(SOURCE), str(destination), transfer
                    )[1:],
                    compat.cached_args(SOURCE, destination, transfer),
                )

    def test_static_thumbnail(self):
        for transfer in TRANSFERS:
            with self.subTest(transfer=transfer):
                with mock.patch.object(
                    render.binaries, "run_tool", return_value=_ran()
                ) as run:
                    render.create_thumbnail_for_video(
                        str(SOURCE), "thumbnails_big", "hash", ".webp", transfer
                    )
                args = run.call_args.args[1]
                self.assertEqual(
                    args, compat.thumbnail_args(SOURCE, args[-1], transfer)
                )

    def test_animated_preview(self):
        for transfer in TRANSFERS:
            with self.subTest(transfer=transfer):
                with mock.patch.object(
                    render.binaries, "run_tool", return_value=_ran()
                ) as run:
                    render.create_animated_thumbnail(
                        str(SOURCE),
                        compat.SQUARE_HEIGHT,
                        "square_thumbnails",
                        "hash",
                        transfer,
                    )
                args = run.call_args.args[1]
                self.assertEqual(args, compat.preview_args(SOURCE, args[-1], transfer))

    def test_metadata_free_copy(self):
        part = Path("/copies/clip.part.mov")
        with mock.patch.object(copies.binaries, "run_tool", return_value=_ran()) as run:
            copies._write_video(str(SOURCE), str(part))
        self.assertEqual(run.call_args.args[1], compat.remux_args(SOURCE, part))
