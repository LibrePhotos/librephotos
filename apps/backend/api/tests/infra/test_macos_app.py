import os
import plistlib
import signal
import struct
import tempfile
import threading
from pathlib import Path
from unittest import skipIf
from unittest.mock import MagicMock, call, patch

import yaml
from django.test import SimpleTestCase

from api.tests.infra.deploy_files import BACKEND_ROOT, REPO_ROOT
from api.tests.stubs import load_backend_file
from librephotos import login_item, macos_app, release_layout, root_watch, standalone
from librephotos.release_layout import MACOS_ARM64
from librephotos.updater import Launch

APP = Path("/Applications/LibrePhotos Server.app")
BINARY = APP / "Contents" / "Resources" / "librephotos" / "librephotos"


def bundle_script():
    return load_backend_file("scripts/macos_bundle.py", name="macos_bundle_probe")


def build_script():
    return load_backend_file("scripts/build_standalone.py", name="build_standalone_mac")


def thin_header(filetype, magic=b"\xcf\xfa\xed\xfe"):
    return magic + struct.pack("<III", 0x0100000C, 0, filetype) + b"\0" * 16


class AppleScriptTest(SimpleTestCase):
    def test_text_is_quoted_and_escaped(self):
        self.assertEqual(
            macos_app.applescript_text('say "hi" \\o/'), '"say \\"hi\\" \\\\o/"'
        )

    def test_the_dialogs(self):
        self.assertIn(
            'display alert "LibrePhotos"', macos_app.alert_script("Port 8000")
        )
        confirm = macos_app.confirm_script("Restart to update?", "A job runs.")
        self.assertIn('buttons {"Cancel", "Restart"}', confirm)
        self.assertIn('cancel button "Cancel"', confirm)

    def test_messages_never_wait_and_never_fail(self):
        with patch.object(macos_app.subprocess, "Popen") as popen:
            macos_app.notify("LibrePhotos 1.8.0 is ready", 'Choose "Restart"')
            macos_app.alert("Port 8000 is used")
            popen.side_effect = OSError(2, "no osascript")
            macos_app.notify("t", "x")
        script = popen.call_args_list[0].args[0][2]
        self.assertEqual(
            script,
            'display notification "Choose \\"Restart\\"" '
            'with title "LibrePhotos 1.8.0 is ready"',
        )
        self.assertIn("display alert", popen.call_args_list[1].args[0][2])

    def test_confirm_is_yes_only_for_restart(self):
        with patch.object(macos_app.subprocess, "run") as run:
            run.return_value = MagicMock(returncode=0)
            self.assertTrue(macos_app.confirm("t", "x"))
            run.return_value = MagicMock(returncode=1)
            self.assertFalse(macos_app.confirm("t", "x"))
        self.assertEqual(run.call_args.args[0][0], "/usr/bin/osascript")

    def test_launch_services_sets_the_bundle_id(self):
        bundle = {"__CFBundleIdentifier": release_layout.BUNDLE_ID}
        self.assertTrue(macos_app.launched_by_launch_services(bundle))
        self.assertFalse(macos_app.launched_by_launch_services({}))
        terminal = {"__CFBundleIdentifier": "com.apple.Terminal"}
        self.assertFalse(macos_app.launched_by_launch_services(terminal))


class MainThreadTest(SimpleTestCase):
    def test_tasks_from_other_threads_run_on_the_main_thread(self):
        main = macos_app.MainThread()
        seen = []

        def worker():
            seen.append(
                main.call(lambda: threading.current_thread() is threading.main_thread())
            )
            main.submit(lambda: seen.append("submitted"))
            main.submit(main.finish)

        threading.Thread(target=worker).start()
        main.serve()
        self.assertEqual(seen, [True, "submitted"])

    def test_a_failed_task_fails_the_caller(self):
        main = macos_app.MainThread()
        errors = []

        def worker():
            try:
                main.call(lambda: 1 / 0)
            except RuntimeError as error:
                errors.append(error)
            main.finish()

        threading.Thread(target=worker).start()
        main.serve()
        self.assertEqual(len(errors), 1)

    def test_appkit_takes_over_the_pending_tasks(self):
        main = macos_app.MainThread()
        first, second = MagicMock(), MagicMock()
        with patch.object(macos_app, "_call_after") as call_after:
            main.submit(first)
            main.enter_appkit()
            main.submit(second)
            main.leave_appkit()
        self.assertEqual(call_after.call_args_list, [call(first), call(second)])

    def test_termination_asks_once(self):
        on_quit = MagicMock()
        finished = threading.Event()
        termination = macos_app.Termination(on_quit, finished)
        self.assertTrue(termination.request())
        self.assertFalse(termination.request())
        on_quit.assert_called_once_with()
        finished.set()
        reply = MagicMock()
        with patch.object(macos_app, "_call_after") as call_after:
            termination.reply_when_finished(reply)
        call_after.assert_called_once_with(reply)


class LoginItemTest(SimpleTestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.home = Path(directory.name)

    def test_the_agent_opens_the_app_in_the_background(self):
        agent = login_item.agent(APP, ["--data-dir", "/Volumes/Photos/LP"])
        self.assertEqual(agent["Label"], "com.librephotos.server")
        self.assertEqual(
            agent["ProgramArguments"],
            [
                "/usr/bin/open",
                "-g",
                "-a",
                str(APP),
                "--args",
                "--data-dir",
                "/Volumes/Photos/LP",
                "run",
                "--no-browser",
            ],
        )
        self.assertTrue(agent["RunAtLoad"])
        self.assertEqual(
            agent["AssociatedBundleIdentifiers"], ["com.librephotos.server"]
        )

    def test_on_and_off(self):
        self.assertFalse(login_item.is_enabled(self.home))
        path = login_item.enable(APP, self.home)
        self.assertEqual(
            path, self.home / "Library/LaunchAgents/com.librephotos.server.plist"
        )
        with open(path, "rb") as handle:
            self.assertEqual(plistlib.load(handle)["ProgramArguments"][3], str(APP))
        self.assertTrue(login_item.is_enabled(self.home))
        with (
            patch.object(login_item.subprocess, "run") as run,
            patch.object(login_item.os, "getuid", return_value=501, create=True),
        ):
            self.assertTrue(login_item.disable(self.home))
            self.assertFalse(login_item.disable(self.home))
        run.assert_called_once()
        self.assertEqual(
            run.call_args.args[0],
            ["/bin/launchctl", "bootout", "gui/501/com.librephotos.server"],
        )
        self.assertFalse(path.exists())


class StandaloneOnMacTest(SimpleTestCase):
    def test_the_root_process_is_read_from_the_environment(self):
        self.assertEqual(root_watch.root_pid({"LIBREPHOTOS_ROOT_PID": "123"}), 123)
        self.assertIsNone(
            root_watch.root_pid({"LIBREPHOTOS_ROOT_PID": str(os.getpid())})
        )
        self.assertIsNone(root_watch.root_pid({"LIBREPHOTOS_ROOT_PID": "x"}))
        self.assertIsNone(root_watch.root_pid({}))

    def test_a_child_ends_itself_when_the_root_is_gone(self):
        answers = iter([True, True, False])
        sleeps = []
        with (
            patch.object(root_watch.os, "kill") as kill,
            patch.object(root_watch.os, "_exit") as exit_now,
            patch.object(root_watch, "stop_children") as stop_children,
        ):
            root_watch.exit_with_root(7, lambda pid: next(answers), sleeps.append)
        stop_children.assert_called_once_with()
        kill.assert_called_once_with(os.getpid(), signal.SIGTERM)
        exit_now.assert_called_once_with(1)
        self.assertEqual(
            sleeps,
            [root_watch.ROOT_POLL_SECONDS] * 2 + [root_watch.ROOT_GONE_GRACE_SECONDS],
        )

    def test_a_process_that_does_not_exist_is_not_alive(self):
        self.assertFalse(root_watch.root_alive(2**22 + 12345))
        self.assertTrue(root_watch.root_alive(os.getpid()))

    def test_without_a_root_nothing_is_watched(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("LIBREPHOTOS_ROOT_PID", None)
            self.assertIsNone(root_watch.watch_root())

    def test_the_root_marks_itself(self):
        environ = {}
        root_watch.mark_root(environ)
        self.assertEqual(environ, {"LIBREPHOTOS_ROOT_PID": str(os.getpid())})

    @skipIf(os.name == "nt", "the null device is a POSIX file here")
    def test_output_to_the_null_device_is_discarded(self):
        with open(os.devnull, "w") as null:
            self.assertTrue(standalone._is_null_device(null))
        with tempfile.TemporaryFile("w") as regular:
            self.assertFalse(standalone._is_null_device(regular))
        self.assertFalse(standalone._is_null_device(object()))

    def test_a_signed_bundle_gets_no_process_name_links(self):
        compiled = MagicMock(standalone=True, original_argv0=str(BINARY))
        with (
            patch.object(standalone, "__compiled__", compiled, create=True),
            patch.object(
                standalone.release_layout, "current", return_value=MACOS_ARM64
            ),
            patch.object(standalone.os, "link") as link,
        ):
            self.assertEqual(
                standalone.named_executable("tags"), os.path.abspath(BINARY)
            )
        link.assert_not_called()

    def test_messages_name_the_mac_command_and_docs(self):
        with (
            patch.object(
                standalone.release_layout, "current", return_value=MACOS_ARM64
            ),
            patch.object(standalone, "install_root", return_value=str(BINARY.parent)),
            patch("api.runtime.ports.port_owner", return_value=None),
        ):
            message = standalone.port_unavailable_message(8000, None)
            self.assertEqual(standalone.program_folder(), APP)
        self.assertIn(
            f"'{APP / 'Contents' / 'MacOS' / 'LibrePhotos Server'}' run --port 8080",
            message,
        )
        self.assertIn("documentation for macOS", message)

    def test_the_login_item_keeps_the_data_folder(self):
        launch = Launch(("--data-dir", "/Volumes/LP", "run", "--no-browser"), {}, "/")
        self.assertEqual(
            standalone.login_item_where(launch),
            ["--data-dir", os.path.abspath("/Volumes/LP")],
        )
        self.assertEqual(standalone.login_item_where(None), [])

    def test_start_at_login_needs_the_mac_app(self):
        launch = Launch(("start-at-login", "on"), {}, "/")
        self.assertEqual(standalone.start_at_login("on", launch), 2)
        self.assertEqual(
            standalone.parse_args(["start-at-login", "status"]).state, "status"
        )

    def test_start_at_login_in_the_mac_app(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        home = Path(directory.name)
        launch = Launch(("start-at-login", "on"), {}, "/")
        with (
            patch.object(
                standalone.release_layout, "current", return_value=MACOS_ARM64
            ),
            patch.object(standalone, "standalone_executable", return_value=str(BINARY)),
            patch.object(standalone, "install_root", return_value=str(BINARY.parent)),
            patch.object(standalone, "login_item_home", return_value=home),
            patch.object(login_item.subprocess, "run"),
            patch.object(login_item.os, "getuid", return_value=501, create=True),
        ):
            self.assertEqual(standalone.start_at_login("on", launch), 0)
            self.assertTrue(standalone.login_item_enabled())
            standalone.toggle_login_item(launch)
            self.assertFalse(standalone.login_item_enabled())
            standalone.toggle_login_item(launch)
            self.assertTrue(standalone.login_item_enabled())
            self.assertEqual(standalone.start_at_login("off", launch), 0)
            self.assertFalse(standalone.login_item_enabled())

    @skipIf(os.name == "nt", "Windows shows its notification area icon")
    def test_no_menu_bar_without_the_main_thread_loop(self):
        startup = standalone.Startup()
        with patch.dict(os.environ, {"BASE_DATA": "d", "BASE_LOGS": "l"}):
            startup.show_tray("http://localhost:8000/")
        self.assertIsNone(startup.tray)


class MacBundleScriptTest(SimpleTestCase):
    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        cls.bundle = bundle_script()

    def test_mach_o_files_are_told_apart(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            (folder / "exe").write_bytes(thin_header(2))
            (folder / "lib.dylib").write_bytes(thin_header(6))
            (folder / "text.txt").write_bytes(b"#!/usr/bin/perl\n")
            fat_header = b"\xca\xfe\xba\xbe" + struct.pack(
                ">IiiIII", 1, 0, 0, 64, 32, 0
            )
            padding = b"\0" * (64 - len(fat_header))
            (folder / "fat").write_bytes(fat_header + padding + thin_header(2))
            self.assertEqual(self.bundle.macho_kind(folder / "exe"), "executable")
            self.assertEqual(self.bundle.macho_kind(folder / "lib.dylib"), "library")
            self.assertIsNone(self.bundle.macho_kind(folder / "text.txt"))
            self.assertEqual(self.bundle.macho_kind(folder / "fat"), "executable")
            self.assertIsNone(self.bundle.macho_kind(folder / "missing"))

    def test_signing_goes_inside_out(self):
        with tempfile.TemporaryDirectory() as directory:
            app = Path(directory) / "LibrePhotos Server.app"
            deep = app / "Contents" / "Resources" / "librephotos" / "numpy" / "core.so"
            deep.parent.mkdir(parents=True)
            deep.write_bytes(thin_header(8))
            top = app / "Contents" / "MacOS" / "LibrePhotos Server"
            top.parent.mkdir(parents=True)
            top.write_bytes(thin_header(2))
            order = self.bundle.signing_order(app)
            self.assertEqual(order, [(deep, "library"), (top, "executable")])

    def test_signing_commands(self):
        entitlements = Path("e.plist")
        ad_hoc = self.bundle.Signing(entitlements=entitlements)
        self.assertTrue(ad_hoc.ad_hoc)
        command = ad_hoc.command(Path("x.so"), executable=False)
        self.assertIn("--timestamp=none", command)
        self.assertIn("runtime", command)
        self.assertNotIn("--entitlements", command)
        identity = self.bundle.Signing(
            "Developer ID Application: L (T)", "k.keychain", entitlements
        )
        command = identity.command(Path("x"), executable=True)
        self.assertIn("--timestamp", command)
        self.assertEqual(command[command.index("--entitlements") + 1], "e.plist")
        self.assertEqual(command[command.index("--keychain") + 1], "k.keychain")

    def test_the_app_is_a_menu_bar_app(self):
        plist = self.bundle.info_plist("1.7.0")
        self.assertIs(plist["LSUIElement"], True)
        self.assertEqual(plist["CFBundleExecutable"], "LibrePhotos Server")
        self.assertEqual(plist["CFBundleIdentifier"], release_layout.BUNDLE_ID)
        self.assertEqual(plist["CFBundleShortVersionString"], "1.7.0")
        self.assertEqual(plist["LSMinimumSystemVersion"], "14.0")
        self.assertIn("NSDocumentsFolderUsageDescription", plist)
        self.assertIn(
            "com.apple.security.cs.disable-library-validation", self.bundle.ENTITLEMENTS
        )

    def test_disk_image_names(self):
        self.assertEqual(
            self.bundle.dmg_names("1.7.0", "macos-arm64"),
            [
                "LibrePhotos-Server-1.7.0-macos-arm64.dmg",
                "LibrePhotos-Server-macos-arm64.dmg",
            ],
        )
        self.assertEqual(
            self.bundle.dmg_names("0.0.0", "macos-arm64"),
            ["LibrePhotos-Server-macos-arm64.dmg"],
        )

    def test_notarization_needs_every_key(self):
        with patch.dict(os.environ, {"APPLE_API_KEY_PATH": "k.p8"}):
            os.environ.pop("APPLE_API_KEY_ID", None)
            self.assertIsNone(self.bundle.Notary.from_environment())

    def test_the_build_names_the_mac_assets(self):
        build = build_script()
        with (
            patch.object(build.sys, "platform", "darwin"),
            patch.object(build.platform, "machine", return_value="arm64"),
        ):
            self.assertEqual(build.platform_suffix(), "macos-arm64")
            self.assertEqual(build.checksums_name(), "SHA256SUMS-macos-arm64")
            self.assertEqual(build.platform_options("1.7.0"), [])
        self.assertIn("--windows-console-mode=attach", build.platform_options("1.7.0"))


class MacWorkflowTest(SimpleTestCase):
    def test_the_workflow_uses_the_names_the_build_and_the_updater_use(self):
        workflow = yaml.safe_load(
            (REPO_ROOT / ".github" / "workflows" / "standalone-macos.yml").read_text(
                encoding="utf-8"
            )
        )
        env = workflow["env"]
        self.assertEqual(env["STABLE_ZIP"], MACOS_ARM64.archive_name)
        self.assertEqual(env["CHECKSUMS"], MACOS_ARM64.checksums_name)
        self.assertEqual(
            env["STABLE_DMG"], bundle_script().dmg_names("0.0.0", "macos-arm64")[0]
        )
        self.assertEqual(env["REUSE_BUILD_FROM_RUN"], "")
        self.assertNotIn(
            "--latest",
            (REPO_ROOT / ".github" / "workflows" / "standalone-macos.yml").read_text(
                encoding="utf-8"
            ),
        )

    def test_the_cask_installs_what_the_release_ships(self):
        cask = (REPO_ROOT / "deploy" / "homebrew" / "librephotos-server.rb").read_text(
            encoding="utf-8"
        )
        self.assertIn('app "LibrePhotos Server.app"', cask)
        self.assertIn("LibrePhotos-Server-#{version}-macos-arm64.dmg", cask)
        self.assertIn(f'launchctl: "{release_layout.BUNDLE_ID}"', cask)
        self.assertIn("~/Library/Application Support/LibrePhotos", cask)

    def test_the_uninstaller_keeps_the_library_by_default(self):
        script = (BACKEND_ROOT / "macos" / "uninstall.sh").read_text(encoding="utf-8")
        self.assertTrue(script.startswith("#!/bin/sh\n"))
        self.assertIn('if [ "$delete_data" = 1 ]; then', script)
        self.assertIn(release_layout.BUNDLE_ID, script)
