"""A sidecar whose port another program holds is reported, not silently retried (#2324).

start_service logged "started successfully" as soon as Popen returned. A
sidecar whose port was taken died right away, the watchdog restarted it every
minute, and every photo of a scan missed its thumbnails, dates, faces or tags,
with the reason only in a log file. A program that answered ``/health`` with
200 on the port even passed for a healthy sidecar.
"""

import errno
import os
import socket
from io import StringIO
from unittest.mock import MagicMock, patch

import requests
from django.core.management import call_command
from django.test import SimpleTestCase, TestCase
from rest_framework.test import APIClient

from api.runtime import sidecars, supervisor
from api.runtime.ports import PortOwner
from api.tests.stubs import load_backend_file, unique_module_name
from api.tests.utils import api_error, create_test_user
from librephotos import standalone
from librephotos.env import EnvError
from service import _common

TAKEN = OSError(errno.EADDRINUSE, "address in use")
STRANGER = PortOwner(77, "nginx.exe")


def health_answer(body: object) -> MagicMock:
    response = MagicMock(status_code=200)
    if isinstance(body, Exception):
        response.json.side_effect = body
    else:
        response.json.return_value = body
    return response


def forget_errors(test: SimpleTestCase) -> None:
    for state in (supervisor._logged_errors, supervisor._start_errors):
        state.clear()
        test.addCleanup(state.clear)


class HealthIdentityTest(SimpleTestCase):
    """is_healthy only counts an answer from the sidecar it asked for."""

    def setUp(self):
        forget_errors(self)

    def healthy(self, body: object) -> bool:
        with (
            patch(
                "api.runtime.supervisor.requests.get", return_value=health_answer(body)
            ),
            patch("api.runtime.supervisor.port_owner", return_value=STRANGER),
        ):
            return supervisor.is_healthy("exif")

    def test_the_sidecar_itself_is_healthy(self):
        self.assertTrue(self.healthy({"status": "OK", "service": "exif"}))

    def test_another_sidecar_on_the_port_is_not(self):
        with self.assertLogs("api.runtime.supervisor", "ERROR") as logs:
            self.assertFalse(self.healthy({"status": "OK", "service": "tags"}))
        self.assertIn(
            f"Port {sidecars.SERVICES['exif']} answers but is not LibrePhotos' exif "
            "service (nginx.exe, process ID 77)",
            logs.output[0],
        )

    def test_a_stranger_answering_200_is_not(self):
        with self.assertLogs("api.runtime.supervisor", "ERROR"):
            self.assertFalse(self.healthy(ValueError("not JSON")))
        self.assertFalse(self.healthy(["OK"]))

    def test_the_watchdog_says_it_once(self):
        with self.assertLogs("api.runtime.supervisor", "DEBUG") as logs:
            for _ in range(3):
                self.healthy({"status": "OK"})
        errors = [line for line in logs.output if line.startswith("ERROR")]
        self.assertEqual(len(errors), 1, logs.output)


def exited(returncode: int = 1) -> MagicMock:
    process = MagicMock(pid=500, returncode=returncode)
    process.poll.return_value = returncode
    return process


def running() -> MagicMock:
    process = MagicMock(pid=501, returncode=None)
    process.poll.return_value = None
    return process


class StartVerificationTest(SimpleTestCase):
    """start_service waits for the sidecar's own answer, or its exit."""

    def setUp(self):
        forget_errors(self)
        supervisor._processes.clear()
        self.addCleanup(supervisor._processes.clear)
        for patcher in (
            patch("api.runtime.supervisor.is_service_enabled", return_value=True),
            patch("api.runtime.supervisor.START_POLL_SECONDS", 0),
        ):
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_a_sidecar_that_dies_on_a_taken_port_is_a_failure_naming_the_owner(self):
        bind_errors = iter([None, TAKEN])  # free before the start, taken after
        with (
            patch("api.runtime.supervisor._answers_as_itself", return_value=False),
            patch(
                "api.runtime.supervisor.bind_error",
                side_effect=lambda h, p: next(bind_errors),
            ),
            patch("api.runtime.supervisor.port_owner", return_value=STRANGER),
            patch("api.runtime.supervisor._is_sidecar_process", return_value=False),
            patch("api.runtime.supervisor.subprocess.Popen", return_value=exited()),
            self.assertLogs("api.runtime.supervisor", "INFO") as logs,
        ):
            self.assertFalse(supervisor.start_service("exif"))

        port = sidecars.SERVICES["exif"]
        reason = f"port {port} is used by nginx.exe (process ID 77)"
        self.assertEqual(supervisor.start_error("exif"), reason)
        self.assertTrue(
            any(
                line.startswith("ERROR")
                and f"Service 'exif' could not start: {reason}" in line
                and "SIDECAR_PORT_EXIF" in line
                for line in logs.output
            ),
            logs.output,
        )
        self.assertFalse(
            any("started" in line and "INFO" in line for line in logs.output)
        )

    def test_a_taken_port_is_not_even_tried(self):
        with (
            patch("api.runtime.supervisor._answers_as_itself", return_value=False),
            patch("api.runtime.supervisor.bind_error", return_value=TAKEN),
            patch("api.runtime.supervisor.port_owner", return_value=STRANGER),
            patch("api.runtime.supervisor._is_sidecar_process", return_value=False),
            patch("api.runtime.supervisor.subprocess.Popen") as popen,
            self.assertLogs("api.runtime.supervisor", "ERROR"),
        ):
            self.assertFalse(supervisor.start_service("thumbnail"))
        popen.assert_not_called()

    def test_started_only_once_it_answers_as_itself(self):
        answers = iter([False, False, False, True])  # before the start, then polls
        with (
            patch(
                "api.runtime.supervisor._answers_as_itself",
                side_effect=lambda s: next(answers),
            ),
            patch("api.runtime.supervisor.bind_error", return_value=None),
            patch("api.runtime.supervisor.subprocess.Popen", return_value=running()),
            self.assertLogs("api.runtime.supervisor", "INFO") as logs,
        ):
            self.assertTrue(supervisor.start_service("exif"))
        self.assertIn(
            f"Service 'exif' started on port {sidecars.SERVICES['exif']}",
            logs.output[-1],
        )
        self.assertIsNone(supervisor.start_error("exif"))

    def test_a_crash_for_another_reason_says_so(self):
        with (
            patch("api.runtime.supervisor._answers_as_itself", return_value=False),
            patch("api.runtime.supervisor.bind_error", return_value=None),
            patch("api.runtime.supervisor.subprocess.Popen", return_value=exited(3)),
            self.assertLogs("api.runtime.supervisor", "ERROR") as logs,
        ):
            self.assertFalse(supervisor.start_service("tags"))
        self.assertIn("it exited with code 3", logs.output[0])
        self.assertEqual(supervisor.start_error("tags"), "it exited with code 3")

    def test_one_still_loading_after_the_timeout_counts_as_started(self):
        with (
            patch("api.runtime.supervisor._answers_as_itself", return_value=False),
            patch("api.runtime.supervisor.bind_error", return_value=None),
            patch("api.runtime.supervisor.subprocess.Popen", return_value=running()),
            patch("api.runtime.supervisor.START_TIMEOUT_SECONDS", 0),
            self.assertLogs("api.runtime.supervisor", "WARNING") as logs,
        ):
            self.assertTrue(supervisor.start_service("face_recognition"))
        self.assertIn("still starting", logs.output[0])

    def test_one_already_answering_is_not_started_twice(self):
        with (
            patch("api.runtime.supervisor._answers_as_itself", return_value=True),
            patch("api.runtime.supervisor.subprocess.Popen") as popen,
        ):
            self.assertTrue(supervisor.start_service("exif"))
        popen.assert_not_called()

    def test_all_are_started_before_any_is_waited_for(self):
        order = []
        answers = {"exif": iter([False, True]), "tags": iter([False, True])}

        def answer(service):
            order.append(("probe", service))
            return next(answers[service])

        def popen(argv, env):
            order.append(("start", argv[-1]))
            return running()

        with (
            patch("api.runtime.supervisor._answers_as_itself", side_effect=answer),
            patch("api.runtime.supervisor.bind_error", return_value=None),
            patch("api.runtime.supervisor._service_command", side_effect=lambda s: [s]),
            patch("api.runtime.supervisor.subprocess.Popen", side_effect=popen),
        ):
            self.assertEqual(
                supervisor.start_services(["exif", "tags"]),
                {"exif": True, "tags": True},
            )
        last_start = max(i for i, step in enumerate(order) if step[0] == "start")
        self.assertEqual(
            order[last_start + 1 :], [("probe", "exif"), ("probe", "tags")]
        )


class PortConflictTest(SimpleTestCase):
    def test_a_free_port_is_no_conflict(self):
        with patch("api.runtime.supervisor.bind_error", return_value=None):
            self.assertIsNone(supervisor.port_conflict("exif"))

    def test_the_sidecar_itself_holding_it_is_no_conflict(self):
        with (
            patch("api.runtime.supervisor.bind_error", return_value=TAKEN),
            patch(
                "api.runtime.supervisor.port_owner", return_value=PortOwner(9, "python")
            ),
            patch("psutil.Process") as process,
        ):
            process.return_value.cmdline.return_value = [
                "python",
                "service/exif/main.py",
            ]
            self.assertIsNone(supervisor.port_conflict("exif"))
            process.return_value.cmdline.return_value = [
                "python",
                "service/tags/main.py",
            ]
            self.assertIn("python (process ID 9)", supervisor.port_conflict("exif"))

    def test_an_owner_the_os_hides_is_still_a_conflict(self):
        with (
            patch("api.runtime.supervisor.bind_error", return_value=TAKEN),
            patch("api.runtime.supervisor.port_owner", return_value=None),
            patch(
                "api.runtime.supervisor._service_process_running", return_value=False
            ),
            patch("api.runtime.supervisor._answers_as_itself", return_value=False),
        ):
            self.assertEqual(
                supervisor.port_conflict("ocr"),
                f"port {sidecars.SERVICES['ocr']} is used by another program",
            )

    def test_a_real_listener_is_found(self):
        with socket.socket() as blocker:
            blocker.bind(("127.0.0.1", 0))
            blocker.listen()
            port = blocker.getsockname()[1]
            with patch.dict(sidecars.SERVICES, {"exif": port}):
                conflict = supervisor.port_conflict("exif")
        self.assertIsNotNone(conflict)
        self.assertIn(f"port {port} is used by", conflict)


class ConfigurablePortTest(SimpleTestCase):
    """SIDECAR_PORT_<NAME> moves a sidecar, for the backend and the sidecar alike."""

    def load(self, environment: dict[str, str]):
        with patch.dict(os.environ, environment):
            return load_backend_file(
                "api/runtime/sidecars.py", name=unique_module_name("sidecars")
            )

    def test_the_variable_moves_the_url(self):
        module = self.load({"SIDECAR_PORT_EXIF": "18010"})
        self.assertEqual(
            module.sidecar_url("exif", "/health"), "http://127.0.0.1:18010/health"
        )
        self.assertEqual(module.SERVICES["tags"], 8011)

    def test_the_sidecar_binds_the_moved_port(self):
        module = self.load({"SIDECAR_PORT_EXIF": "18010"})
        with (
            patch.dict(sidecars.SERVICES, module.SERVICES),
            patch.dict(os.environ),
            patch("gevent.pywsgi.WSGIServer") as server,
        ):
            os.environ.pop("SERVICE_HOST", None)
            _common.serve_forever(MagicMock(), "exif")
        self.assertEqual(server.call_args.args[0], ("127.0.0.1", 18010))

    def test_defaults_without_the_variables(self):
        environment = {sidecars.port_variable(name): "" for name in sidecars.SERVICES}
        self.assertEqual(
            self.load(environment).SERVICES,
            {
                "image_similarity": 8002,
                "thumbnail": 8003,
                "face_recognition": 8005,
                "image_captioning": 8007,
                "exif": 8010,
                "tags": 8011,
                "ocr": 8012,
            },
        )

    def test_a_value_that_is_no_port_stops_the_process_naming_it(self):
        for value in ("http", "0", "70000"):
            with (
                self.subTest(value),
                self.assertRaisesMessage(EnvError, "SIDECAR_PORT_OCR"),
            ):
                self.load({"SIDECAR_PORT_OCR": value})


class StartAllSummaryTest(TestCase):
    def test_the_command_names_what_did_not_start_and_why(self):
        def start_services(names):
            supervisor._start_errors["exif"] = (
                "port 8010 is used by nginx.exe (process ID 77)"
            )
            return {name: name != "exif" for name in names}

        out = StringIO()
        forget_errors(self)
        with (
            patch(
                "api.management.commands.start_service.start_services",
                side_effect=start_services,
            ),
            patch(
                "api.management.commands.start_service.is_service_enabled",
                return_value=True,
            ),
        ):
            call_command("start_service", "all", stdout=out)
        self.assertIn(
            "Service exif could not start: port 8010 is used by nginx.exe (process ID 77)",
            out.getvalue(),
        )
        self.assertNotIn("Service tags", out.getvalue())


class ServicesApiTest(TestCase):
    def setUp(self):
        forget_errors(self)
        admin = create_test_user(
            is_admin=True, username="admin", email="admin@test.com"
        )
        self.client = APIClient()
        self.client.force_authenticate(user=admin)

    def test_a_down_sidecar_says_who_holds_its_port(self):
        with (
            patch("api.views.services.is_service_enabled", return_value=True),
            patch("api.views.services.is_healthy", return_value=False),
            patch(
                "api.views.services.port_conflict",
                return_value="port 8010 is used by nginx.exe (process ID 77)",
            ),
        ):
            response = self.client.get("/api/services/exif/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json()["port_conflict"],
            "port 8010 is used by nginx.exe (process ID 77)",
        )

    def test_a_healthy_sidecar_is_not_probed(self):
        with (
            patch("api.views.services.is_service_enabled", return_value=True),
            patch("api.views.services.is_healthy", return_value=True),
            patch("api.views.services.port_conflict") as conflict,
        ):
            response = self.client.get("/api/services/exif/")
        self.assertIsNone(response.json()["port_conflict"])
        conflict.assert_not_called()

    def test_a_failed_start_names_the_reason(self):
        def start_service(name):
            supervisor._start_errors[name] = (
                "port 8010 is used by nginx.exe (process ID 77)"
            )
            return False

        with (
            patch("api.views.services.is_service_enabled", return_value=True),
            patch("api.views.services.start_service", side_effect=start_service),
        ):
            response = self.client.post("/api/services/exif/start/")
        self.assertEqual(response.status_code, 500)
        self.assertIn("nginx.exe", api_error(response)["message"])


class StandalonePreflightTest(SimpleTestCase):
    """The standalone build lists blocked sidecar ports in one message box."""

    def test_a_blocked_sidecar_port_stops_the_start_with_its_owner(self):
        with socket.socket() as blocker:
            blocker.bind(("127.0.0.1", 0))
            blocker.listen()
            port = blocker.getsockname()[1]
            with (
                patch.dict(sidecars.SERVICES, {"exif": port}),
                patch(
                    "api.runtime.supervisor.is_service_enabled",
                    side_effect=lambda s: s == "exif",
                ),
                patch("api.runtime.ports.port_owner", return_value=STRANGER),
                self.assertRaises(standalone.StartupError) as raised,
            ):
                standalone.check_sidecar_ports()
        message = str(raised.exception)
        self.assertIn(f"Port {port} (exif): nginx.exe, process ID 77", message)
        self.assertIn(f"SIDECAR_PORT_EXIF={port + 10000}", message)
        self.assertIn('"Using another port"', message)

    def test_free_or_disabled_ports_pass(self):
        with (
            patch(
                "api.runtime.supervisor.is_service_enabled",
                side_effect=lambda s: s != "ocr",
            ),
            patch(
                "api.runtime.ports.bind_error",
                side_effect=lambda host, port: (
                    TAKEN if port == sidecars.SERVICES["ocr"] else None
                ),
            ),
        ):
            standalone.check_sidecar_ports()

    def test_run_server_checks_them_before_starting_any(self):
        error = standalone.StartupError("ports")
        with (
            patch.object(standalone, "_already_running", return_value=False),
            patch.object(standalone.instance_lock, "acquire", return_value=MagicMock()),
            patch.object(standalone, "_capture_console_output"),
            patch.object(standalone, "check_port"),
            patch.object(standalone, "_take_children_down_with_us"),
            patch.object(standalone, "prepare_database"),
            patch("django.setup"),
            patch.object(standalone, "check_sidecar_ports", side_effect=error),
            patch.object(standalone, "_shutdown"),
            patch.object(standalone, "run_manage") as manage,
            self.assertRaises(standalone.StartupError),
        ):
            standalone.run_server("127.0.0.1", 8000, open_browser=False, tray=False)
        manage.assert_not_called()


class HealthRequestTest(SimpleTestCase):
    def test_a_refused_probe_is_no_answer(self):
        with patch(
            "api.runtime.supervisor.requests.get",
            side_effect=requests.ConnectionError("refused"),
        ):
            self.assertFalse(supervisor._answers_as_itself("exif"))
