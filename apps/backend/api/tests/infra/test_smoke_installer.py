import json
import tempfile
from pathlib import Path
from unittest.mock import patch

from django.test import SimpleTestCase

from api.tests.infra.test_installation import make_program
from api.tests.stubs import load_backend_file, unique_module_name
from api.updates.download import parse_checksums
from api.updates.extract import check_release, extract_release
from api.updates.stage import is_staged

smoke = load_backend_file(
    "scripts/smoke_standalone.py", name=unique_module_name("smoke_standalone")
)
build = load_backend_file(
    "scripts/build_standalone.py", name=unique_module_name("build_standalone")
)
signing = load_backend_file(
    "scripts/windows_signing.py", name=unique_module_name("windows_signing")
)
installer = load_backend_file(
    "scripts/build_installer.py",
    name=unique_module_name("build_installer"),
    stubs={"build_standalone": build, "windows_signing": signing},
)
installer_smoke = load_backend_file(
    "scripts/smoke_installer.py",
    name=unique_module_name("smoke_installer"),
    stubs={
        "smoke_standalone": smoke,
        "build_standalone": build,
        "build_installer": installer,
    },
)


class ReleaseFeedTest(SimpleTestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.work = Path(folder.name)
        self.dist = make_program(self.work / "build", version="")
        (self.dist / "frontend_build").mkdir()
        (self.dist / "frontend_build" / "index.html").write_text("<html></html>")

    def test_a_stamped_zip_is_a_release_the_updater_accepts(self):
        feed = installer_smoke.Feed(self.work / "feed")
        folder = installer_smoke.publish(feed, self.dist, "98.0.1", None, self.work)
        self.assertEqual(
            folder, self.work / "feed" / "releases" / "download" / "98.0.1"
        )
        unpacked = self.work / "unpacked"
        unpacked.mkdir()
        program = extract_release(folder / installer_smoke.ZIP_NAME, unpacked)
        check_release(program, "98.0.1")
        sums = (folder / "SHA256SUMS").read_text(encoding="utf-8")
        self.assertTrue(parse_checksums(sums, installer_smoke.ZIP_NAME))
        self.assertEqual(
            json.loads((self.dist / "build_info.json").read_text())["version"], ""
        )
        self.assertFalse((self.work / "stamped" / "98.0.1").exists())

    def test_the_old_release_finds_the_staged_one_ready(self):
        feed = installer_smoke.Feed(self.work / "feed")
        folder = installer_smoke.publish(feed, self.dist, "98.0.0", None, self.work)
        old = make_program(self.work / "app", version="1.6.0")
        staged = installer_smoke.stage_for_old_release(old, folder, "98.0.0")
        self.assertEqual(staged, self.work / "app" / "librephotos-98.0.0")
        self.assertTrue(is_staged(staged, "98.0.0"))
        self.assertEqual(
            sorted(path.name for path in (self.work / "app").iterdir()),
            ["librephotos", "librephotos-98.0.0"],
        )

    def test_the_local_feed_is_served_where_the_source_says(self):
        feed = installer_smoke.Feed(self.work / "feed")
        (feed.folder("98.0.0") / "SHA256SUMS").write_text("x")
        with installer_smoke.serve(feed) as source:
            import requests

            answer = requests.get(f"{source}/98.0.0/SHA256SUMS", timeout=5)
        self.assertTrue(source.startswith("http://127.0.0.1:"))
        self.assertEqual(answer.text, "x")


class BuildInstallerTest(SimpleTestCase):
    def test_a_dev_build_only_gets_the_stable_name(self):
        self.assertEqual(installer.setup_names("0.0.0"), ["LibrePhotos-Setup.exe"])
        self.assertEqual(
            installer.setup_names("1.7.0"),
            ["LibrePhotos-Setup-1.7.0.exe", "LibrePhotos-Setup.exe"],
        )

    def test_the_compiler_gets_the_build_and_the_version(self):
        with patch.dict(installer.os.environ, {}, clear=True):
            command = installer.iscc_command(
                Path("ISCC.exe"), Path("dist"), Path("out"), "1.7.0", "lzma2/fast"
            )
        self.assertIn("/DAppVersion=1.7.0", command)
        self.assertIn("/DOutputName=LibrePhotos-Setup-1.7.0", command)
        self.assertIn("/DCompression=lzma2/fast", command)
        self.assertEqual(command[-1], str(installer.SCRIPT))
        self.assertFalse(any(part.startswith("/S") for part in command))

    def test_with_signing_arguments_inno_signs_the_installer_too(self):
        environ = {
            "WINDOWS_SIGN_ARGS": 'sign /fd SHA256 /f "C:\\a b\\c.pfx" /p secret',
            "WINDOWS_SIGNTOOL": "C:\\sdk\\signtool.exe",
        }
        with (
            patch.dict(installer.os.environ, environ, clear=True),
            patch.dict(signing.os.environ, environ, clear=True),
        ):
            command = installer.iscc_command(
                Path("ISCC.exe"), Path("dist"), Path("out"), "1.7.0", "lzma2/max"
            )
            self.assertEqual(
                signing.sign_arguments(),
                ["sign", "/fd", "SHA256", "/f", "C:\\a b\\c.pfx", "/p", "secret"],
            )
        self.assertIn("/DSignToolName=librephotos", command)
        tool = next(part for part in command if part.startswith("/Slibrephotos="))
        self.assertTrue(tool.endswith(" $f"))
        self.assertIn('"C:\\a b\\c.pfx"', tool)

    def test_without_signing_arguments_nothing_is_signed(self):
        with (
            patch.dict(signing.os.environ, {}, clear=True),
            patch.object(signing.subprocess, "run") as run,
        ):
            self.assertEqual(signing.sign_folder(Path(".")), 0)
        run.assert_not_called()

    def test_every_program_file_is_signed_in_batches(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            for index in range(signing.BATCH + 1):
                (root / f"m{index}.pyd").write_bytes(b"MZ")
            (root / "readme.txt").write_text("x")
            with patch.object(signing.subprocess, "run") as run:
                count = signing.sign(signing.pe_files(root), ["sign"], "signtool.exe")
        self.assertEqual(count, signing.BATCH + 1)
        self.assertEqual(run.call_count, 2)
