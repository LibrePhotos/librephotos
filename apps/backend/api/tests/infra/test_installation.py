import os
import re
import tempfile
from pathlib import Path

from django.test import SimpleTestCase

from api.tests.infra.deploy_files import BACKEND_ROOT
from librephotos import installation
from librephotos.installation import (
    INSTALLED,
    PORTABLE,
    MoveRecord,
    Where,
    announce_move,
    forward_target,
    installed_program,
    layout,
    read_move_record,
    release_version,
    setup_command,
    sync_display_version,
    where_options,
    write_move_record,
)

INNO_SCRIPT = BACKEND_ROOT / "installer" / "librephotos.iss"


class FakeRegistry:
    def __init__(self, **values):
        self.values = dict(values)
        self.writes = []

    def read(self, name):
        return self.values.get(name)

    def write(self, name, value):
        self.writes.append((name, value))
        self.values[name] = value


def make_program(root, name="librephotos", version="1.7.0"):
    program = Path(root) / name
    program.mkdir(parents=True)
    (program / "librephotos.exe").write_bytes(b"MZ")
    (program / "build_info.json").write_text(f'{{"version": "{version}"}}')
    return program


class InstallFolderTestCase(SimpleTestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.root = Path(folder.name)
        self.app = self.root / "Programs" / "LibrePhotos"
        self.program = make_program(self.app)
        self.registry = FakeRegistry(InstallLocation=str(self.app) + os.sep)


class LayoutTest(InstallFolderTestCase):
    def test_the_program_folder_of_the_install_location_is_installed(self):
        self.assertEqual(layout(self.program, self.registry), INSTALLED)

    def test_a_rollback_next_to_it_counts_as_installed_too(self):
        rollback = make_program(self.app, "librephotos-old")
        self.assertEqual(layout(rollback, self.registry), INSTALLED)

    def test_an_unzipped_folder_is_portable(self):
        unzipped = make_program(self.root / "LibrePhotos-app")
        self.assertEqual(layout(unzipped, self.registry), PORTABLE)
        self.assertEqual(layout(unzipped, FakeRegistry()), PORTABLE)
        self.assertEqual(layout(unzipped, FakeRegistry(InstallLocation=" ")), PORTABLE)

    def test_the_installed_program_needs_its_executable(self):
        self.assertEqual(installed_program(self.registry), self.app / "librephotos")
        (self.program / "librephotos.exe").unlink()
        self.assertIsNone(installed_program(self.registry))
        self.assertIsNone(installed_program(FakeRegistry()))

    def test_release_version_reads_the_build_info(self):
        self.assertEqual(release_version(self.program), "1.7.0")
        (self.program / "build_info.json").write_text("not json")
        self.assertEqual(release_version(self.program), "")
        self.assertEqual(release_version(self.root), "")


class DisplayVersionTest(InstallFolderTestCase):
    def test_an_installed_copy_writes_its_version_and_numbers(self):
        self.registry.values["DisplayVersion"] = "1.6.9"
        self.assertTrue(sync_display_version(self.program, "1.7.0", self.registry))
        self.assertEqual(
            self.registry.writes,
            [("DisplayVersion", "1.7.0"), ("MajorVersion", 1), ("MinorVersion", 7)],
        )

    def test_nothing_is_written_when_it_is_right_already(self):
        self.registry.values["DisplayVersion"] = "1.7.0"
        self.assertFalse(sync_display_version(self.program, "1.7.0", self.registry))
        self.assertEqual(self.registry.writes, [])

    def test_a_portable_copy_or_a_build_without_version_writes_nothing(self):
        unzipped = make_program(self.root / "elsewhere")
        self.assertFalse(sync_display_version(unzipped, "1.7.0", self.registry))
        self.assertFalse(sync_display_version(self.program, "", self.registry))
        self.assertEqual(self.registry.writes, [])

    def test_a_version_without_numbers_only_sets_the_text(self):
        self.assertTrue(sync_display_version(self.program, "2026w20", self.registry))
        self.assertEqual(self.registry.writes, [("DisplayVersion", "2026w20")])


class WhereOptionsTest(SimpleTestCase):
    def test_both_spellings_are_read_until_the_subcommand(self):
        where = where_options(
            ["--data-dir", "D:\\Lib", "--photos=E:\\", "run", "--data-dir", "X"],
            stop_at=("run", "manage"),
        )
        self.assertEqual(where, Where(data_dir="D:\\Lib", photos="E:\\"))

    def test_relative_folders_are_resolved_from_the_working_folder(self):
        cwd = str(Path(tempfile.gettempdir()))
        where = where_options(["--data-dir", "lib"], cwd)
        self.assertEqual(where.data_dir, os.path.abspath(os.path.join(cwd, "lib")))

    def test_a_missing_value_is_ignored(self):
        self.assertEqual(where_options(["--data-dir"]), Where())

    def test_the_installer_gets_the_folders_and_runs_silently(self):
        command = setup_command(
            Path("S.exe"), Path("setup.log"), Where("D:\\Libre Photos", "E:\\")
        )
        self.assertEqual(
            command,
            [
                "S.exe",
                "/VERYSILENT",
                "/SUPPRESSMSGBOXES",
                "/NORESTART",
                "/SP-",
                "/SKIPRUNNINGCHECK",
                "/LOG=setup.log",
                "/DATADIR=D:\\Libre Photos",
                "/PHOTOS=E:\\",
            ],
        )
        self.assertEqual(len(setup_command(Path("S.exe"), Path("l"), Where())), 7)


class MoveRecordTest(InstallFolderTestCase):
    def setUp(self):
        super().setUp()
        self.data = self.root / "data"
        self.data.mkdir()
        self.unzipped = make_program(self.root / "LibrePhotos-app")

    def record(self):
        return MoveRecord.now(self.unzipped, self.program, "1.7.0")

    def test_it_round_trips_and_a_broken_one_is_none(self):
        write_move_record(self.data, self.record())
        self.assertEqual(read_move_record(self.data).moved_to, str(self.program))
        (self.data / installation.MOVE_RECORD_NAME).write_text('{"x": 1}')
        self.assertIsNone(read_move_record(self.data))
        (self.data / installation.MOVE_RECORD_NAME).write_text("[")
        self.assertIsNone(read_move_record(self.data))

    def test_the_old_copy_hands_over_to_the_installed_one(self):
        self.assertIsNone(forward_target(self.unzipped, self.data, self.registry))
        write_move_record(self.data, self.record())
        self.assertEqual(
            forward_target(self.unzipped, self.data, self.registry),
            self.program / "librephotos.exe",
        )

    def test_nothing_is_handed_over_from_another_folder_or_without_an_install(self):
        write_move_record(self.data, self.record())
        other = make_program(self.root / "other")
        self.assertIsNone(forward_target(other, self.data, self.registry))
        self.assertIsNone(forward_target(self.unzipped, self.data, FakeRegistry()))
        self.assertIsNone(forward_target(self.program, self.data, self.registry))

    def test_the_installed_copy_announces_the_move_once(self):
        write_move_record(self.data, self.record())
        self.assertIsNone(announce_move(self.unzipped, self.data))
        announced = announce_move(self.program, self.data)
        self.assertEqual(announced.moved_from, str(self.unzipped))
        self.assertIsNone(announce_move(self.program, self.data))
        self.assertTrue(read_move_record(self.data).announced)


class InnoScriptTest(SimpleTestCase):
    def test_the_installer_registers_the_key_the_app_reads(self):
        script = INNO_SCRIPT.read_text(encoding="utf-8")
        app_id = re.search(r'#define AppId "([0-9A-F-]+)"', script).group(1)
        self.assertEqual(installation.APP_ID, "{" + app_id + "}")
        self.assertTrue(installation.UNINSTALL_KEY.endswith("{" + app_id + "}_is1"))

    def test_it_installs_per_user_into_the_layout_the_updater_swaps_in(self):
        script = INNO_SCRIPT.read_text(encoding="utf-8")
        for line in (
            "PrivilegesRequired=lowest",
            "DefaultDirName={userpf}\\LibrePhotos",
            '#define ProgramExe "{app}\\librephotos\\librephotos.exe"',
            'DestDir: "{app}\\librephotos"',
            "UninstallDisplayIcon={#ProgramExe}",
            'Type: filesandordirs; Name: "{app}\\librephotos-*"',
        ):
            self.assertIn(line, script)

    def test_autostart_and_the_desktop_shortcut_are_off_unless_chosen(self):
        script = INNO_SCRIPT.read_text(encoding="utf-8")
        tasks = [
            line
            for line in script.splitlines()
            if line.startswith(('Name: "desktopicon"', 'Name: "autostart"'))
        ]
        self.assertEqual(len(tasks), 2)
        for task in tasks:
            self.assertIn("Flags: unchecked", task)

    def test_the_switches_the_app_passes_are_the_ones_it_reads(self):
        script = INNO_SCRIPT.read_text(encoding="utf-8")
        self.assertIn(f"HasSwitch('{installation.SKIP_RUNNING_CHECK}')", script)
        self.assertIn("{param:DATADIR}", script)
        self.assertIn("{param:PHOTOS}", script)
