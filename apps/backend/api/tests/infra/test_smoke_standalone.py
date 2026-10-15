"""scripts/smoke_standalone.py, which runs a standalone build in CI (#2319).

The script itself is only exercised end to end by standalone-windows.yml (or
``--from-source`` by hand); these tests cover its decisions with fakes: which
folder it runs, what environment the build gets, and when a check fails.
"""

import base64
import io
import json
import socket
import subprocess
import tempfile
import unittest
import zipfile
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import psutil
import requests
from django.test import SimpleTestCase

from api.runtime import supervisor
from api.runtime.sidecars import SERVICES
from api.tests.infra.deploy_files import repository_present
from api.tests.stubs import load_backend_file, unique_module_name
from librephotos.standalone import PROCESS_NAMES

smoke = load_backend_file(
    "scripts/smoke_standalone.py", name=unique_module_name("smoke_standalone")
)


def access_token(claims):
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b"=")
    return f"header.{payload.decode()}.signature"


class FakeApi:
    """Answers api.json() from a dict of (method, path) -> body."""

    def __init__(self, answers):
        self.answers = answers
        self.calls = []

    def json(self, method, path, **kwargs):
        self.calls.append((method, path, kwargs))
        answer = self.answers[(method, path)]
        return answer(kwargs) if callable(answer) else answer


class ProgramFolderTest(SimpleTestCase):
    def make_program(self, folder):
        folder.mkdir(parents=True)
        (folder / smoke.EXECUTABLE).write_bytes(b"MZ")
        return folder

    def test_the_folder_with_the_executable_or_its_parent(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            program = self.make_program(work / "build" / "librephotos")

            self.assertEqual(program.resolve(), smoke.program_folder(program, work))
            self.assertEqual(
                program.resolve(), smoke.program_folder(program.parent, work)
            )

    def test_a_zip_is_extracted_into_the_work_folder(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            archive = work / "librephotos-windows-x64.zip"
            with zipfile.ZipFile(archive, "w") as bundle:
                bundle.writestr(f"librephotos/{smoke.EXECUTABLE}", b"MZ")

            found = smoke.program_folder(archive, work)

            self.assertEqual((work / "program" / "librephotos").resolve(), found)
            self.assertTrue((found / smoke.EXECUTABLE).is_file())

    def test_no_executable_or_no_zip_fails(self):
        with tempfile.TemporaryDirectory() as tmp:
            work = Path(tmp)
            with self.assertRaisesRegex(smoke.SmokeError, "no librephotos.exe"):
                smoke.program_folder(work, work)
            with self.assertRaisesRegex(smoke.SmokeError, "no zip"):
                smoke.program_folder(work / "missing.zip", work)


class EnvironmentTest(SimpleTestCase):
    def test_settings_of_the_calling_shell_do_not_reach_the_build(self):
        base = {
            "PATH": "C:\\Windows",
            "BASE_DATA": "D:\\real-library",
            "base_logs": "D:\\logs",
            "IMAGE_TAG": "dev",
            "SIDECAR_PORT_EXIF": "9999",
        }

        environment = smoke.app_environment(base, {"exif": 1234, "tags": 1235})

        self.assertEqual("C:\\Windows", environment["PATH"])
        for name in ("BASE_DATA", "base_logs", "IMAGE_TAG"):
            self.assertNotIn(name, environment)
        self.assertEqual("1234", environment["SIDECAR_PORT_EXIF"])
        self.assertEqual("1235", environment["SIDECAR_PORT_TAGS"])
        self.assertEqual("1", environment["WORKER_CONCURRENCY"])

    def test_free_ports_are_distinct_and_bindable(self):
        ports = smoke.free_ports(1 + len(SERVICES))

        self.assertEqual(len(ports), len(set(ports)))
        for port in ports:
            with socket.socket() as probe:
                probe.bind(("127.0.0.1", port))

    def test_the_command_puts_the_data_and_photos_folders_first(self):
        layout = smoke.Layout(Path("W:/work"))
        app = smoke.App(["librephotos.exe"], layout, {})

        command = app.command("manage", "scan")

        self.assertEqual(
            [
                "librephotos.exe",
                "--data-dir",
                str(layout.data),
                "--photos",
                str(layout.photos),
                "manage",
                "scan",
            ],
            command,
        )


class TokenTest(SimpleTestCase):
    def test_the_user_id_claim_is_read_from_the_access_token(self):
        self.assertEqual(7, smoke.token_user_id(access_token({"user_id": "7"})))

    def test_a_token_without_a_user_id_fails(self):
        for token in ("not-a-jwt", access_token({"sub": "x"}), "a.!!!.c"):
            with self.subTest(token=token):
                with self.assertRaises(smoke.SmokeError):
                    smoke.token_user_id(token)


class WaitUntilTest(SimpleTestCase):
    def setUp(self):
        self.now = [0.0]
        patches = [
            patch.object(smoke.time, "monotonic", lambda: self.now[0]),
            patch.object(smoke.time, "sleep", self.advance),
        ]
        for started in patches:
            started.start()
            self.addCleanup(started.stop)

    def advance(self, seconds):
        self.now[0] += seconds

    def test_returns_the_first_truthy_result(self):
        results = iter([None, [], ["photo"]])

        self.assertEqual(["photo"], smoke.wait_until(lambda: next(results), 60, "x"))

    def test_times_out(self):
        with self.assertRaisesRegex(smoke.SmokeError, "timed out after 10 s"):
            smoke.wait_until(lambda: False, 10, "the thing")

    def test_stops_at_once_when_the_program_exited(self):
        with self.assertRaisesRegex(smoke.SmokeError, "exited while waiting"):
            smoke.wait_until(lambda: False, 600, "ready", still_running=lambda: False)
        self.assertEqual(0.0, self.now[0])


class LogInTest(SimpleTestCase):
    def test_the_admin_is_created_from_the_environment_and_logged_in(self):
        token = access_token({"user_id": "3"})
        passwords = []

        def obtain(kwargs):
            passwords.append(kwargs["json"]["password"])
            return {"access": token}

        api = FakeApi({("POST", "/api/auth/token/obtain/"): obtain})
        api.authenticate = MagicMock()
        app = MagicMock()

        self.assertEqual(3, smoke.log_in(app, api))

        args, kwargs = app.manage.call_args
        self.assertEqual(("createadmin", smoke.ADMIN_USERNAME, smoke.ADMIN_EMAIL), args)
        # Through the environment, never the command line.
        self.assertEqual(passwords[0], kwargs["extra"]["ADMIN_PASSWORD"])
        self.assertNotIn(passwords[0], args)
        api.authenticate.assert_called_once_with(token)

    def test_a_login_without_a_token_fails(self):
        api = FakeApi({("POST", "/api/auth/token/obtain/"): {"detail": "no"}})

        with self.assertRaisesRegex(smoke.SmokeError, "no access token"):
            smoke.log_in(MagicMock(), api)


class TagTest(SimpleTestCase):
    def api(self, tag):
        return FakeApi(
            {("GET", "/api/imagetag/"): {"image_tag": tag, "git_hash": "abc"}}
        )

    def test_the_reported_tag_must_match(self):
        smoke.check_tag(self.api("1.4.0"), "1.4.0")
        with self.assertRaisesRegex(smoke.SmokeError, "expected '1.4.0'"):
            smoke.check_tag(self.api("dev"), "1.4.0")

    def test_without_a_tag_anything_goes(self):
        smoke.check_tag(self.api(""), None)


class ServicesTest(SimpleTestCase):
    def api(self, enabled):
        answers = {("GET", "/api/services/"): {"services": dict(SERVICES)}}
        for name in SERVICES:
            answers[("GET", f"/api/services/{name}/")] = {
                "service_name": name,
                "enabled": name in enabled,
                "healthy": name in enabled,
            }
        return FakeApi(answers)

    def test_the_always_on_sidecars_need_no_switch_or_model(self):
        # A sidecar behind a feature switch or a site setting may be off in a
        # build without anything being wrong; these ones may not.
        for name in smoke.ALWAYS_ON_SERVICES:
            with self.subTest(service=name):
                self.assertIn(name, SERVICES)
                self.assertIsNone(supervisor.SERVICE_FEATURES[name])
                self.assertNotIn(name, supervisor.SERVICE_SITE_GATES)

    def test_the_enabled_sidecars_are_checked(self):
        enabled = {*smoke.ALWAYS_ON_SERVICES, "face_recognition"}

        self.assertEqual(
            sorted(enabled), sorted(smoke.enabled_services(self.api(enabled)))
        )

    def test_an_always_on_sidecar_that_is_off_fails(self):
        with self.assertRaisesRegex(smoke.SmokeError, "must always run"):
            smoke.enabled_services(self.api({"exif"}))

    def test_a_sidecar_is_healthy_only_as_itself_on_its_port(self):
        api = self.api({"exif"})
        with (
            patch.object(smoke, "sidecar_identity", return_value="tags"),
            patch.object(smoke, "SERVICE_TIMEOUT_SECONDS", 0),
        ):
            with self.assertRaisesRegex(smoke.SmokeError, "exif sidecar on port 1"):
                smoke.check_service(api, "exif", 1, lambda: True)
        with patch.object(smoke, "sidecar_identity", return_value="exif"):
            smoke.check_service(api, "exif", 1, lambda: True)

    def test_sidecar_identity_reads_the_health_body(self):
        def answer(body, status=200):
            return MagicMock(status_code=status, json=MagicMock(return_value=body))

        with patch.object(smoke.requests, "get") as get:
            get.return_value = answer({"status": "OK", "service": "exif"})
            self.assertEqual("exif", smoke.sidecar_identity(1))
            get.return_value = answer({"service": "exif"}, status=503)
            self.assertIsNone(smoke.sidecar_identity(1))
            get.return_value = answer(["not", "a", "dict"])
            self.assertIsNone(smoke.sidecar_identity(1))
            get.side_effect = requests.ConnectionError()
            self.assertIsNone(smoke.sidecar_identity(1))


class ProcessNamesTest(SimpleTestCase):
    def test_the_root_the_cluster_and_each_enabled_sidecar_have_a_name(self):
        expected = smoke.expected_process_names(["exif", "tags"])

        self.assertEqual(
            {
                "librephotos.exe",
                f"{PROCESS_NAMES['jobs']}.exe",
                f"{PROCESS_NAMES['worker']}.exe",
                f"{PROCESS_NAMES['exif']}.exe",
                f"{PROCESS_NAMES['tags']}.exe",
            },
            expected,
        )

    def test_a_missing_name_fails(self):
        running = [
            SimpleNamespace(name=lambda: "librephotos.exe"),
            SimpleNamespace(name=lambda: f"{PROCESS_NAMES['jobs']}.exe"),
        ]
        with patch.object(smoke, "processes_in", return_value=running):
            with self.assertRaisesRegex(smoke.SmokeError, PROCESS_NAMES["worker"]):
                smoke.check_process_names(Path("P:/program"), [])

    def test_processes_are_matched_by_their_executable_folder(self):
        program = Path(tempfile.gettempdir()) / "program"
        here = SimpleNamespace(info={"exe": str(program / "librephotos-jobs.exe")})
        elsewhere = SimpleNamespace(
            info={"exe": str(program / "librephotos" / "librephotos.exe")}
        )
        hidden = SimpleNamespace(info={"exe": None})
        with patch.object(
            smoke.psutil, "process_iter", return_value=[here, elsewhere, hidden]
        ):
            self.assertEqual([here], smoke.processes_in(program))


class ScanTest(SimpleTestCase):
    def test_three_photos_are_scanned_and_their_thumbnails_served(self):
        with tempfile.TemporaryDirectory() as tmp:
            layout = smoke.Layout(Path(tmp))
            layout.create()
            app = MagicMock(layout=layout)
            photos = [{"image_hash": f"h{index}"} for index in range(3)]
            api = FakeApi(
                {
                    ("PATCH", "/api/manage/user/5/"): {},
                    ("GET", "/api/photos/recentlyadded/"): {"results": photos},
                }
            )
            api.request = MagicMock(
                return_value=MagicMock(
                    status_code=200, headers={"Content-Type": "image/webp"}
                )
            )

            smoke.scan_samples(app, api, 5)

            self.assertEqual(
                sorted(smoke.SAMPLE_NAMES),
                sorted(path.name for path in layout.library.iterdir()),
            )
            self.assertEqual(
                {"scan_directory": str(layout.library)}, api.calls[0][2]["json"]
            )
            app.manage.assert_called_once_with("scan")
            self.assertEqual(
                [f"/media/thumbnails_big/h{index}" for index in range(3)],
                [call.args[1] for call in api.request.call_args_list],
            )

    def test_too_few_thumbnails_are_not_enough(self):
        api = FakeApi({("GET", "/api/photos/recentlyadded/"): {"results": [{}]}})

        self.assertIsNone(smoke.thumbnailed_photos(api, 3))

    @unittest.skipUnless(
        repository_present(), "needs the repository checkout (deploy/)"
    )
    def test_the_sample_photos_exist(self):
        for name in smoke.SAMPLE_NAMES:
            self.assertTrue((smoke.SAMPLE_PHOTOS / name).is_file(), name)


class ShutdownTest(SimpleTestCase):
    """Only the root is killed; whatever outlives it fails the test."""

    def app(self):
        app = MagicMock()
        app.process = MagicMock(pid=123)
        return app

    def test_a_clean_exit_passes(self):
        child = MagicMock(spec=psutil.Process)
        child.is_running.return_value = False
        app = self.app()
        with (
            patch.object(smoke.psutil, "Process") as process,
            patch.object(smoke, "processes_in", return_value=[]),
        ):
            process.return_value.children.return_value = [child]
            smoke.check_shutdown(app, Path("P:/program"))

        app.process.kill.assert_called_once_with()
        child.kill.assert_not_called()

    def test_a_survivor_fails_and_is_cleaned_up(self):
        survivor = MagicMock(spec=psutil.Process, pid=456)
        survivor.is_running.return_value = True
        survivor.status.return_value = psutil.STATUS_RUNNING
        survivor.name.return_value = "librephotos-tags.exe"
        app = self.app()
        with (
            patch.object(smoke.psutil, "Process") as process,
            patch.object(smoke, "processes_in", return_value=[]),
            patch.object(smoke, "EXIT_TIMEOUT_SECONDS", 0),
        ):
            process.return_value.children.return_value = [survivor]
            with self.assertRaisesRegex(
                smoke.SmokeError, r"librephotos-tags.exe \(PID 456\)"
            ):
                smoke.check_shutdown(app, None)

        survivor.kill.assert_called_once_with()


class LogsTest(SimpleTestCase):
    def test_every_log_is_printed_in_a_group(self):
        with tempfile.TemporaryDirectory() as tmp:
            logs = Path(tmp)
            (logs / "librephotos.log").write_text("one\ntwo\n", encoding="utf-8")
            (logs / "smoke-run.log").write_text("started\n", encoding="utf-8")
            out = io.StringIO()

            smoke.dump_logs(logs, out)

        text = out.getvalue()
        self.assertIn("::group::librephotos.log\none\ntwo\n::endgroup::", text)
        self.assertIn("::group::smoke-run.log\nstarted\n::endgroup::", text)

    def test_only_the_tail_is_printed(self):
        with tempfile.TemporaryDirectory() as tmp:
            log = Path(tmp) / "a.log"
            log.write_text("\n".join(str(n) for n in range(10)), encoding="utf-8")

            self.assertEqual("8\n9", smoke.tail(log, 2))


class CleanUpTest(SimpleTestCase):
    def test_a_root_still_running_is_killed_with_its_children(self):
        app = smoke.App(["x"], smoke.Layout(Path("W:/w")), {})
        app.process = MagicMock(pid=1)
        app.process.poll.return_value = None
        child = MagicMock(spec=psutil.Process)
        with patch.object(smoke.psutil, "Process") as process:
            process.return_value.children.return_value = [child]
            smoke.clean_up(app)

        app.process.kill.assert_called_once_with()
        child.kill.assert_called_once_with()

    def test_a_root_that_exited_is_left_alone(self):
        app = smoke.App(["x"], smoke.Layout(Path("W:/w")), {})
        app.process = MagicMock(pid=1)
        app.process.poll.return_value = 0

        smoke.clean_up(app)

        app.process.kill.assert_not_called()


class ApiTest(SimpleTestCase):
    def api(self, status, body=None, error=None):
        api = smoke.Api("http://127.0.0.1:1/")
        response = MagicMock(ok=200 <= status < 300, status_code=status, text="t")
        response.json.return_value = body
        api.session.request = MagicMock(return_value=response, side_effect=error)
        return api

    def test_a_2xx_answer_gives_its_body(self):
        api = self.api(200, {"a": 1})

        self.assertEqual({"a": 1}, api.json("GET", "/api/x/"))
        self.assertEqual(
            "http://127.0.0.1:1/api/x/", api.session.request.call_args.args[1]
        )

    def test_any_other_answer_fails(self):
        with self.assertRaisesRegex(smoke.SmokeError, "GET /api/x/ answered 503"):
            self.api(503).json("GET", "/api/x/")

    def test_answers_is_a_yes_or_no(self):
        self.assertTrue(self.api(200).answers("/api/healthz/ready/"))
        self.assertFalse(self.api(503).answers("/api/healthz/ready/"))
        refused = self.api(200, error=requests.ConnectionError())
        self.assertFalse(refused.answers("/api/healthz/ready/"))

    def test_the_token_goes_into_every_request(self):
        api = smoke.Api("http://127.0.0.1:1")

        api.authenticate("abc")

        self.assertEqual("Bearer abc", api.session.headers["Authorization"])


class MainTest(SimpleTestCase):
    def test_a_program_or_from_source_is_required(self):
        for argv in ([], ["build", "--from-source"]):
            with self.subTest(argv=argv):
                with self.assertRaises(SystemExit), patch("sys.stderr"):
                    smoke.parse_args(argv)

    def test_a_failure_cleans_up_prints_the_logs_and_exits_1(self):
        with tempfile.TemporaryDirectory() as tmp:
            with (
                patch.object(smoke, "run_checks", side_effect=smoke.SmokeError("x")),
                patch.object(smoke, "clean_up") as clean_up,
                patch.object(smoke, "dump_logs") as dump_logs,
                patch("sys.stderr"),
                patch("sys.stdout"),
            ):
                code = smoke.main(["--from-source", "--work-dir", tmp])

        self.assertEqual(1, code)
        clean_up.assert_called()
        dump_logs.assert_called_once()

    def test_an_unexpected_error_still_takes_the_build_down(self):
        with tempfile.TemporaryDirectory() as tmp:
            with (
                patch.object(smoke, "run_checks", side_effect=KeyError("x")),
                patch.object(smoke, "clean_up") as clean_up,
                patch("sys.stdout"),
            ):
                with self.assertRaises(KeyError):
                    smoke.main(["--from-source", "--work-dir", tmp])

        clean_up.assert_called_once()

    def test_a_pass_exits_0(self):
        with tempfile.TemporaryDirectory() as tmp:
            with (
                patch.object(smoke, "run_checks") as run_checks,
                patch.object(smoke, "clean_up"),
                patch("sys.stdout"),
            ):
                code = smoke.main(["--from-source", "--work-dir", tmp])

        self.assertEqual(0, code)
        app, program, tag = run_checks.call_args.args
        self.assertIsNone(program)
        self.assertIsNone(tag)
        self.assertEqual(str(smoke.ENTRY_SCRIPT), app.launcher[-1])

    def test_a_manage_command_that_fails_says_why(self):
        app = smoke.App(["x"], smoke.Layout(Path("W:/w")), {})
        failed = subprocess.CompletedProcess([], 1, "out", "CommandError: no")
        with patch.object(smoke.subprocess, "run", return_value=failed):
            with self.assertRaisesRegex(smoke.SmokeError, "CommandError: no"):
                app.manage("scan")
