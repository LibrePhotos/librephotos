"""Our ExifTool client (api.metadata.exiftool_client) against the real ExifTool.

What PyExifTool 0.4.9 did not do, and the exif sidecar needs: every command
times out, an ExifTool that died or hung is replaced on the next command, and
what ExifTool printed on stderr reaches the error. Reads answer in the shapes
PyExifTool answered (grouped keys and numbers with the default arguments).
"""

import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

import PIL.Image
from django.test import SimpleTestCase

from api.metadata.exiftool_client import (
    ExifTool,
    ExifToolError,
    ExifToolProcess,
    ExifToolTimeoutError,
    decode_output,
    without_paths,
)
from api.runtime import binaries

EXIFTOOL = shutil.which("exiftool")

# Perl that ExifTool's -if runs before it reads the file: a command that hangs.
SLEEP = "select(undef, undef, undef, {seconds}); 1"


class DecodeOutputTest(SimpleTestCase):
    def test_utf8_else_latin_1(self):
        self.assertEqual(decode_output("Zoë".encode()), "Zoë")
        self.assertEqual(decode_output(b"Jos\xe9"), "Jos\xe9")

    def test_paths_are_left_out_in_both_spellings(self):
        path = os.path.join("C:" if os.name == "nt" else "/", "photos", "a.jpg")
        message = f"Error: File not found - {path.replace(os.sep, '/')}"
        self.assertEqual(
            without_paths(message, [path]), "Error: File not found - the file"
        )


@unittest.skipUnless(EXIFTOOL, "exiftool binary not available")
class ExifToolClientTest(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.directory = tempfile.mkdtemp(prefix="librephotos-exiftool-client-")
        cls.addClassCleanup(shutil.rmtree, cls.directory, True)
        cls.photo = os.path.join(cls.directory, "Zoë 日本 📷.jpg")
        PIL.Image.new("RGB", (64, 48), (90, 60, 30)).save(cls.photo)
        argfile = os.path.join(cls.directory, "args.txt")
        with open(argfile, "w", encoding="utf-8") as handle:
            handle.write(
                "-overwrite_original\n-charset\nfilename=utf8\n-EXIF:Make=Fujifilm\n"
                "-EXIF:Orientation#=6\n-EXIF:ExposureTime=0.004\n"
                "-XMP-dc:Subject=Straße\n-XMP-dc:Subject+=日本\n"
                f"{cls.photo}\n"
            )
        subprocess.run([EXIFTOOL, "-@", argfile], check=True, capture_output=True)
        cls.missing = os.path.join(cls.directory, "gone.jpg")

    def exiftool(self, **kwargs: object) -> ExifTool:
        et = ExifTool(**kwargs)
        self.addCleanup(et.terminate)
        return et

    def test_grouped_numeric_reads(self):
        et = self.exiftool()
        self.assertEqual(et.get_tag("EXIF:Orientation", self.photo), 6)
        self.assertEqual(et.get_tag("EXIF:ExposureTime", self.photo), 0.004)
        self.assertIsNone(et.get_tag("EXIF:Model", self.photo))
        self.assertEqual(
            et.get_tags(["EXIF:Make", "XMP:Subject"], self.photo),
            {
                "SourceFile": self.photo.replace(os.sep, "/"),
                "EXIF:Make": "Fujifilm",
                "XMP:Subject": ["Straße", "日本"],
            },
        )

    def test_print_converted_reads_without_groups(self):
        et = self.exiftool(common_args=["-struct"])
        self.assertEqual(et.get_tag("Orientation", self.photo), "Rotate 90 CW")

    def test_a_batch_answers_per_file_in_order_and_leaves_out_unreadable_ones(self):
        et = self.exiftool()
        answers = et.get_tags_batch(
            ["EXIF:Make"], [self.photo, self.missing, self.photo]
        )
        self.assertEqual(
            [answer.get("EXIF:Make") for answer in answers], ["Fujifilm", "Fujifilm"]
        )

    def test_stderr_reaches_the_error(self):
        et = self.exiftool()
        with self.assertRaisesRegex(ExifToolError, "File not found"):
            et.get_tag("EXIF:Make", self.missing)
        # It was this command's stderr only: the next one is clean.
        answer = et.run("-EXIF:Make", self.photo)
        self.assertEqual(answer.stderr, b"")
        self.assertEqual(answer.status, 0)

    def test_a_hung_command_times_out_and_the_next_one_gets_a_new_exiftool(self):
        et = self.exiftool(timeout=1)
        started = time.monotonic()
        with self.assertRaises(ExifToolTimeoutError):
            et.run("-if", SLEEP.format(seconds=30), "-EXIF:Make", self.photo)
        self.assertLess(time.monotonic() - started, 15)
        self.assertFalse(et.running)

        self.assertEqual(et.get_tag("EXIF:Make", self.photo), "Fujifilm")
        self.assertTrue(et.running)

    def test_exiftool_killed_mid_command_fails_it_and_the_next_one_works(self):
        et = self.exiftool(timeout=60)
        et.start()
        process = et._process
        assert process is not None
        killer = threading.Timer(0.5, binaries.kill, [process._process])
        killer.start()
        self.addCleanup(killer.cancel)

        with self.assertRaisesRegex(ExifToolError, "ExifTool exited"):
            et.run("-if", SLEEP.format(seconds=30), "-EXIF:Make", self.photo)
        self.assertFalse(et.running)

        self.assertEqual(et.get_tag("EXIF:Make", self.photo), "Fujifilm")

    def test_exiftool_that_died_between_commands_is_replaced(self):
        et = self.exiftool()
        et.start()
        assert et._process is not None
        binaries.kill(et._process._process)

        self.assertFalse(et.running)
        self.assertEqual(et.get_tag("EXIF:Make", self.photo), "Fujifilm")

    def test_terminate_stops_the_process(self):
        et = self.exiftool()
        et.start()
        process = et._process
        assert process is not None
        et.terminate()
        self.assertFalse(et.running)
        self.assertIsNotNone(process._process.poll())

    def test_a_writer_process_reports_status_and_stderr_apart(self):
        process = ExifToolProcess()
        self.addCleanup(process.close)
        answer = process.run([b"-EXIF:Make=x", os.fsencode(self.missing)], 30)
        self.assertNotEqual(answer.status, 0)
        self.assertIn(b"File not found", answer.stderr)
        self.assertNotIn(b"File not found", answer.stdout)


CHILD = """
import os, sys
sys.path.insert(0, os.getcwd())
from api.metadata.exiftool_client import ExifTool
et = ExifTool()
et.start()
print(et._process._process.pid, flush=True)
sys.stdin.read()
"""


@unittest.skipUnless(EXIFTOOL, "exiftool binary not available")
@unittest.skipUnless(sys.platform.startswith("linux"), "PR_SET_PDEATHSIG is Linux's")
class ExifToolOutlivesNoSidecarTest(SimpleTestCase):
    """ExifTool keeps waiting when its stdin closes; a killed sidecar takes it down."""

    def test_exiftool_stops_when_the_process_that_started_it_is_killed(self):
        backend = Path(__file__).resolve().parents[3]
        child = subprocess.Popen(
            [sys.executable, "-c", CHILD],
            cwd=backend,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
        )
        assert child.stdout is not None
        exiftool_pid = int(child.stdout.readline())
        child.kill()
        child.wait()

        deadline = time.monotonic() + 10
        while time.monotonic() < deadline and _running(exiftool_pid):
            time.sleep(0.1)
        self.assertFalse(_running(exiftool_pid))


def _running(pid: int) -> bool:
    import psutil

    try:
        return psutil.Process(pid).status() != psutil.STATUS_ZOMBIE
    except psutil.NoSuchProcess:
        return False
