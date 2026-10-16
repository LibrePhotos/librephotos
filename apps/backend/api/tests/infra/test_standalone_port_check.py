"""The standalone build says when its web server port is taken (#2323).

uvicorn finds a taken port only after migrate, the sidecars and the job
cluster have started, and reports it with SystemExit(3), which main()'s
``except Exception`` let through: the tray icon flickered and LibrePhotos was
gone without a word.
"""

import errno
import socket
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from api.runtime import ports
from api.runtime.ports import PortOwner
from librephotos import standalone


def listening_socket() -> socket.socket:
    """A socket listening on a free loopback port, as another program would."""
    blocker = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    blocker.bind(("127.0.0.1", 0))
    blocker.listen()
    return blocker


class BindErrorTest(SimpleTestCase):
    def test_a_listened_on_port_cannot_be_bound(self):
        with listening_socket() as blocker:
            port = blocker.getsockname()[1]
            error = ports.bind_error("127.0.0.1", port)
        self.assertIsNotNone(error)
        self.assertEqual(error.errno, errno.EADDRINUSE)

    def test_a_free_port_can_be_bound_and_is_left_free(self):
        with listening_socket() as blocker:
            port = blocker.getsockname()[1]
        self.assertIsNone(ports.bind_error("127.0.0.1", port))
        # The probe closed its socket: the port is still free for the server.
        self.assertIsNone(ports.bind_error("127.0.0.1", port))

    def test_an_unknown_host_is_an_error_not_a_crash(self):
        with patch("socket.getaddrinfo", side_effect=socket.gaierror(11001, "no")):
            self.assertIsInstance(
                ports.bind_error("no-such-host.invalid", 8000), OSError
            )


class PortOwnerTest(SimpleTestCase):
    def test_finds_the_process_listening_on_the_port(self):
        with listening_socket() as blocker:
            port = blocker.getsockname()[1]
            owner = ports.port_owner(port)
        # macOS lists other connections only to root; there it may be None.
        if owner is not None:
            self.assertGreater(owner.pid, 0)

    def test_nobody_listening_is_none(self):
        connection = SimpleNamespace(
            status="ESTABLISHED", laddr=SimpleNamespace(port=8000), pid=5
        )
        with patch("psutil.net_connections", return_value=[connection]):
            self.assertIsNone(ports.port_owner(8000))

    def test_a_process_whose_name_is_hidden_still_has_its_pid(self):
        import psutil

        connection = SimpleNamespace(
            status=psutil.CONN_LISTEN, laddr=SimpleNamespace(port=8000), pid=42
        )
        with (
            patch("psutil.net_connections", return_value=[connection]),
            patch("psutil.Process", side_effect=psutil.AccessDenied(42)),
        ):
            self.assertEqual(ports.port_owner(8000), PortOwner(42, None))

    def test_no_permission_to_list_connections_is_none(self):
        import psutil

        with patch("psutil.net_connections", side_effect=psutil.AccessDenied()):
            self.assertIsNone(ports.port_owner(8000))


def in_use() -> OSError:
    return OSError(errno.EADDRINUSE, "address in use")


class PortUnavailableMessageTest(SimpleTestCase):
    def message(self, owner, error):
        with patch("api.runtime.ports.port_owner", return_value=owner):
            return standalone.port_unavailable_message(8000, error)

    def test_names_the_program_holding_the_port(self):
        message = self.message(PortOwner(1234, "python.exe"), in_use())
        self.assertTrue(
            message.startswith(
                "Port 8000 is already used by another program "
                "(python.exe, process ID 1234)."
            )
        )
        self.assertIn("Close that program and start LibrePhotos again", message)
        self.assertIn('"librephotos.exe run --port 8080"', message)
        self.assertIn('"Using another port"', message)

    def test_a_hidden_name_still_gives_the_process_id(self):
        message = self.message(PortOwner(4, None), in_use())
        self.assertIn("(unknown name, process ID 4)", message)

    def test_an_unknown_owner_still_says_the_port_is_taken(self):
        message = self.message(None, in_use())
        self.assertTrue(
            message.startswith("Port 8000 is already used by another program.")
        )

    def test_a_port_windows_refuses_says_so(self):
        # WSAEACCES: a port in a range Hyper-V, WSL or Docker reserved.
        error = OSError(errno.EACCES, "access denied")
        message = self.message(None, error)
        self.assertTrue(message.startswith("LibrePhotos cannot use port 8000"))
        self.assertIn("access denied", message)
        self.assertIn("--port 8080", message)

    def test_the_suggested_port_is_never_the_taken_one(self):
        with patch("api.runtime.ports.port_owner", return_value=None):
            message = standalone.port_unavailable_message(8080, in_use())
        self.assertIn("--port 8081", message)


class PreflightTest(SimpleTestCase):
    """run_server checks the port before it migrates or starts anything."""

    def test_a_taken_port_stops_the_start_before_migrate(self):
        with (
            listening_socket() as blocker,
            patch.object(standalone, "_already_running", return_value=False),
            patch.object(standalone.instance_lock, "acquire", return_value=MagicMock()),
            patch.object(standalone, "_capture_console_output"),
            patch.object(standalone, "_take_children_down_with_us") as job,
            patch.object(standalone, "run_teed", return_value=(0, [])) as teed,
            patch("django.setup") as setup,
            self.assertRaises(standalone.StartupError) as raised,
        ):
            port = blocker.getsockname()[1]
            standalone.run_server("127.0.0.1", port, open_browser=False, tray=False)
        teed.assert_not_called()
        setup.assert_not_called()
        job.assert_not_called()
        self.assertIn(
            f"Port {port} is already used by another program", str(raised.exception)
        )

    def test_the_message_box_says_why(self):
        with (
            listening_socket() as blocker,
            patch.object(standalone, "prepare_environment"),
            patch.object(standalone, "_already_running", return_value=False),
            patch.object(standalone.instance_lock, "acquire", return_value=MagicMock()),
            patch.object(standalone, "_capture_console_output"),
            patch.object(standalone, "run_teed") as teed,
            patch.object(standalone, "_report_failure") as report,
            self.assertRaises(SystemExit) as raised,
        ):
            port = blocker.getsockname()[1]
            standalone.main(["run", "--port", str(port), "--no-browser"])
        self.assertEqual(raised.exception.code, 1)
        teed.assert_not_called()
        report.assert_called_once()
        self.assertIn(f"Port {port}", report.call_args.args[0])


class ServerExitTest(SimpleTestCase):
    """A bind failure uvicorn hits itself (a race after the pre-flight)."""

    def serve(self, bind_error):
        def run():
            raise SystemExit(3)

        server = SimpleNamespace(
            run=run,
            started=False,
            config=SimpleNamespace(host="127.0.0.1", port=8000),
        )
        cluster = object()
        with (
            patch.object(standalone, "_set_console_title"),
            patch.object(standalone, "_shutdown") as shutdown,
            patch("api.runtime.ports.bind_error", return_value=bind_error),
            patch("api.runtime.ports.port_owner", return_value=PortOwner(9, "x.exe")),
        ):
            try:
                standalone._serve(server, cluster, "http://x/", standalone.Startup())
            finally:
                shutdown.assert_called_once_with(cluster)

    def test_uvicorns_system_exit_becomes_the_port_message(self):
        with self.assertRaises(standalone.StartupError) as raised:
            self.serve(in_use())
        self.assertIn(
            "Port 8000 is already used by another program (x.exe", str(raised.exception)
        )

    def test_another_start_failure_is_still_an_error(self):
        with self.assertRaisesMessage(RuntimeError, "127.0.0.1:8000"):
            self.serve(None)

    def test_it_reaches_the_message_box(self):
        def run_server(*args):
            self.serve(in_use())

        with (
            patch.object(standalone, "prepare_environment"),
            patch.object(standalone, "run_server", side_effect=run_server),
            patch.object(standalone, "_report_failure") as report,
            self.assertRaises(SystemExit) as raised,
        ):
            standalone.main(["run"])
        self.assertEqual(raised.exception.code, 1)
        self.assertIn("Port 8000 is already used", report.call_args.args[0])

    def test_a_stop_after_a_successful_start_is_left_alone(self):
        def run():
            server.started = True
            raise SystemExit(0)

        server = SimpleNamespace(run=run, started=False, config=MagicMock())
        with (
            patch.object(standalone, "_set_console_title"),
            patch.object(standalone, "_shutdown"),
            self.assertRaises(SystemExit),
        ):
            standalone._serve(server, object(), "http://x/", standalone.Startup())
