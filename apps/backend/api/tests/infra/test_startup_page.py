"""The start-up page that answers on the server's port until the server does (#2310).

librephotos/startup_page.py runs before Django, in the Docker entrypoint and in
the Windows app. The web app's BackendStatusGate reads its 503s; the single
container and the Windows app also show its HTML page. These tests pin the
contract of PR #2688 (``{"status", "reason_code"?, "version"?}``), that only
fixed values ever leave it, and how the standalone build starts and stops it.
"""

import base64
import errno
import hashlib
import http.client
import json
import os
import re
import socket
import tempfile
from contextlib import redirect_stdout
from io import StringIO
from unittest import skipUnless
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from api.runtime.ports import bind_error
from api.tests.infra.deploy_files import REPO_ROOT
from librephotos import standalone, startup_page
from librephotos.startup_page import FAILED, STARTING, UPDATING, answer, phase

TRANSLATIONS = (
    REPO_ROOT / "apps" / "frontend" / "src" / "locales" / "en" / "translation.json"
)
UPGRADING_PAGE = REPO_ROOT / "apps" / "docs" / "docs" / "installation" / "upgrading.md"
# What a failed command really prints; none of it may reach an answer.
SECRET = "/home/someone/secret/librephotos.sqlite3"
LEAKY_OUTPUT = [
    "Traceback (most recent call last):",
    f'  File "{SECRET}", line 1',
    "psycopg.OperationalError: password authentication failed for user admin",
]


def temporary_file(test: SimpleTestCase, name: str, text: str | None = None) -> str:
    directory = tempfile.TemporaryDirectory()
    test.addCleanup(directory.cleanup)
    path = os.path.join(directory.name, name)
    if text is not None:
        with open(path, "w", encoding="utf-8") as handle:
            handle.write(text)
    return path


class PhaseTest(SimpleTestCase):
    def test_only_the_three_statuses(self):
        for status in (STARTING, UPDATING):
            with self.subTest(status=status):
                self.assertEqual(phase(status), {"status": status})
        self.assertEqual(phase("migrating"), {"status": STARTING})
        self.assertEqual(phase(None), {"status": STARTING})

    def test_a_failure_always_has_a_known_reason_code(self):
        self.assertEqual(
            phase(FAILED, "E001"), {"status": FAILED, "reason_code": "E001"}
        )
        self.assertEqual(phase(FAILED)["reason_code"], "unknown")
        self.assertEqual(phase(FAILED, LEAKY_OUTPUT[2])["reason_code"], "unknown")

    def test_no_reason_code_unless_failed(self):
        self.assertEqual(phase(UPDATING, "E001"), {"status": UPDATING})


class ReasonCodeTest(SimpleTestCase):
    def test_finds_librephotos_check_errors(self):
        for code in ("E001", "E002"):
            with self.subTest(code=code):
                lines = ["ERRORS:", f"?: (librephotos.{code}) The database ...", ""]
                self.assertEqual(startup_page.reason_code(lines), code)

    def test_anything_else_is_unknown(self):
        self.assertEqual(startup_page.reason_code(LEAKY_OUTPUT), "unknown")
        self.assertEqual(startup_page.reason_code([]), "unknown")
        self.assertEqual(
            startup_page.reason_code(["?: (librephotos.E003) new"]), "unknown"
        )

    def test_the_last_one_counts(self):
        lines = ["(librephotos.E001) old", "(librephotos.E002) new"]
        self.assertEqual(startup_page.reason_code(lines), "E002")

    def test_from_a_log_file(self):
        log = temporary_file(self, "command_migrate.log", "(librephotos.E001) x\n")
        self.assertEqual(startup_page.reason_code_from_file(log), "E001")
        self.assertEqual(
            startup_page.reason_code_from_file(log + ".missing"), "unknown"
        )


class PhaseFileTest(SimpleTestCase):
    def test_round_trip(self):
        path = temporary_file(self, "status.json")
        startup_page.write_phase_file(path, FAILED, "E002")
        self.assertEqual(
            startup_page.read_phase_file(path),
            {"status": FAILED, "reason_code": "E002"},
        )
        self.assertFalse(os.path.exists(path + ".tmp"))

    def test_missing_or_broken_reads_as_starting(self):
        path = temporary_file(self, "status.json")
        self.assertEqual(startup_page.read_phase_file(path), {"status": STARTING})
        for text in ("{not json", "[1, 2]", '"failed"'):
            with self.subTest(text=text):
                with open(path, "w", encoding="utf-8") as handle:
                    handle.write(text)
                self.assertEqual(
                    startup_page.read_phase_file(path), {"status": STARTING}
                )

    def test_nothing_but_the_fixed_values_is_read(self):
        path = temporary_file(
            self,
            "status.json",
            json.dumps(
                {"status": FAILED, "reason_code": SECRET, "error": LEAKY_OUTPUT}
            ),
        )
        self.assertEqual(
            startup_page.read_phase_file(path),
            {"status": FAILED, "reason_code": "unknown"},
        )

    def test_holder(self):
        holder = startup_page.PhaseHolder()
        self.assertEqual(holder(), {"status": STARTING})
        holder.set(FAILED, "E001")
        self.assertEqual(holder(), {"status": FAILED, "reason_code": "E001"})
        holder()["status"] = "changed"
        self.assertEqual(holder()["status"], FAILED)


class AnswerTest(SimpleTestCase):
    """What each path answers, per phase, with and without the web app."""

    def json_answer(self, path, current=None, serve_frontend=False, version=None):
        result = answer(path, current or phase(UPDATING), serve_frontend, version)
        self.assertEqual(result.content_type, "application/json")
        self.assertEqual(result.headers["Cache-Control"], "no-store")
        return result, json.loads(result.body)

    def test_liveness_answers_200_in_every_phase(self):
        for current in (phase(STARTING), phase(UPDATING), phase(FAILED, "E001")):
            for path in ("/api/healthz", "/api/healthz/"):
                with self.subTest(current=current, path=path):
                    result, body = self.json_answer(path, current, True)
                    self.assertEqual(result.status, 200)
                    self.assertEqual(body["status"], "ok")
                    self.assertNotIn("Retry-After", result.headers)

    def test_readiness_and_every_api_path_answer_503_with_the_phase(self):
        paths = (
            "/api/healthz/ready",
            "/api/healthz/ready/",
            "/api/auth/token/obtain/",
            "/api",
            "/media/thumbnails_big/x.webp",
        )
        for current in (phase(STARTING), phase(UPDATING), phase(FAILED, "E002")):
            for path in paths:
                with self.subTest(current=current, path=path):
                    result, body = self.json_answer(path, current, True)
                    self.assertEqual(result.status, 503)
                    self.assertEqual(result.headers["Retry-After"], "10")
                    self.assertEqual(body, current)

    def test_the_release_is_named_when_known(self):
        _, body = self.json_answer("/api/healthz/ready", version="2026w42")
        self.assertEqual(body, {"status": UPDATING, "version": "2026w42"})

    def test_without_the_web_app_every_path_answers_json(self):
        result, body = self.json_answer("/", serve_frontend=False)
        self.assertEqual(result.status, 503)
        self.assertEqual(body, {"status": UPDATING})

    def test_with_the_web_app_other_paths_get_the_page(self):
        for path in ("/", "/login", "/photos/abc", "/static/x.js"):
            with self.subTest(path=path):
                result = answer(path, phase(UPDATING), True, None)
                self.assertEqual(result.status, 503)
                self.assertEqual(result.content_type, "text/html; charset=utf-8")
                self.assertEqual(result.headers["Retry-After"], "10")
                self.assertIn("Content-Security-Policy", result.headers)
                self.assertIn(b"LibrePhotos is updating", result.body)


class VersionTest(SimpleTestCase):
    def test_only_a_plain_tag(self):
        self.assertEqual(startup_page.clean_version("1.4.0"), "1.4.0")
        self.assertEqual(startup_page.clean_version("2026w42"), "2026w42")
        self.assertIsNone(startup_page.clean_version(""))
        self.assertIsNone(startup_page.clean_version(None))
        self.assertIsNone(startup_page.clean_version("<script>"))
        self.assertIsNone(startup_page.clean_version("x" * 65))


class PageTest(SimpleTestCase):
    def page(self, *args):
        return startup_page.render_page(phase(*args))

    def test_each_phase_has_its_title_and_tab(self):
        cases = {
            (UPDATING,): ("LibrePhotos is updating", "Updating · LibrePhotos"),
            (STARTING,): ("LibrePhotos is starting", "Starting · LibrePhotos"),
            (FAILED, "E001"): (
                "This LibrePhotos is too old to update in one step",
                "Update failed · LibrePhotos",
            ),
            (FAILED, "E002"): (
                "This database belongs to a newer LibrePhotos",
                "Update failed · LibrePhotos",
            ),
            (FAILED, "unknown"): (
                "The update could not finish",
                "Update failed · LibrePhotos",
            ),
        }
        for args, (title, tab) in cases.items():
            with self.subTest(args=args):
                page = self.page(*args)
                self.assertIn(f'<h1 id="title">{title}</h1>', page)
                self.assertIn(f"<title>{tab}</title>", page)

    def test_a_failure_links_its_section_of_the_upgrade_guide(self):
        page = self.page(FAILED, "E001")
        self.assertIn(f'href="{startup_page.DOCS}#old-releases"', page)
        self.assertIn('<code id="code">E001</code>', page)
        self.assertIn('role="alert"', page)
        self.assertIn('<div id="waiting" hidden>', page)

    def test_waiting_is_a_status_without_the_failure_block(self):
        page = self.page(UPDATING)
        self.assertIn('role="status"', page)
        self.assertIn('<div id="failure" hidden>', page)

    def test_no_text_from_the_status_file_reaches_the_page(self):
        path = temporary_file(
            self,
            "status.json",
            json.dumps({"status": FAILED, "reason_code": SECRET, "detail": SECRET}),
        )
        result = answer("/", startup_page.read_phase_file(path), True, None)
        page = result.body.decode("utf-8")
        self.assertNotIn("secret", page)
        self.assertIn("The update could not finish", page)

    def test_the_policy_allows_exactly_the_inline_style_and_script(self):
        page = self.page(UPDATING)
        policy = startup_page.CONTENT_SECURITY_POLICY
        for tag in ("style", "script"):
            with self.subTest(tag=tag):
                inline = re.findall(rf"<{tag}>(.*?)</{tag}>", page, re.DOTALL)
                self.assertEqual(len(inline), 1)
                digest = hashlib.sha256(inline[0].encode("utf-8")).digest()
                token = base64.b64encode(digest).decode("ascii")
                self.assertIn(f"{tag}-src 'sha256-{token}'", policy)
        self.assertNotIn("unsafe-inline", policy)

    def test_the_texts_block_cannot_end_the_script_early(self):
        texts = re.search(
            r'<script type="application/json" id="texts">(.*?)</script>',
            self.page(UPDATING),
            re.DOTALL,
        )
        assert texts is not None
        self.assertEqual(
            json.loads(texts.group(1).replace("<\\/", "</")), startup_page.TEXTS
        )

    @skipUnless(TRANSLATIONS.is_file(), "needs the repository checkout (apps/frontend)")
    def test_the_texts_are_the_web_apps(self):
        """The gate and this page say the same (backendStatus.* in en)."""
        web = json.loads(TRANSLATIONS.read_text(encoding="utf-8"))["backendStatus"]
        for key in (UPDATING, STARTING):
            with self.subTest(key=key):
                for field in ("title", "text", "tab"):
                    self.assertEqual(startup_page.TEXTS[key][field], web[key][field])
        for code in ("E001", "E002", "unknown"):
            with self.subTest(code=code):
                for field in ("title", "text", "details"):
                    self.assertEqual(
                        startup_page.TEXTS[code][field], web["failed"][code][field]
                    )
                self.assertEqual(startup_page.TEXTS[code]["tab"], web["failed"]["tab"])
        self.assertEqual(startup_page.SLOW_TEXT, web["slow"])

    @skipUnless(UPGRADING_PAGE.is_file(), "needs the repository checkout (apps/docs)")
    def test_every_linked_section_exists(self):
        # Docusaurus checks links but not anchors.
        page = UPGRADING_PAGE.read_text(encoding="utf-8")
        for texts in startup_page.TEXTS.values():
            if "docs" in texts:
                anchor = texts["docs"].split("#", 1)[1]
                with self.subTest(anchor=anchor):
                    self.assertIn(f"{{#{anchor}}}", page)


def request(port, method, path, body=None):
    connection = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
    try:
        connection.request(method, path, body=body)
        response = connection.getresponse()
        return response.status, dict(response.getheaders()), response.read()
    finally:
        connection.close()


class ServerTest(SimpleTestCase):
    """The real server on a free loopback port."""

    def setUp(self):
        self.holder = startup_page.PhaseHolder()
        self.server = startup_page.serve_in_thread(
            "127.0.0.1", 0, self.holder, serve_frontend=True, version="1.4.0"
        )
        self.addCleanup(self.stop_server)
        self.port = self.server.server_address[1]

    def stop_server(self):
        self.server.stop()

    def test_answers_the_contract_and_follows_the_phase(self):
        status, _, body = request(self.port, "GET", "/api/healthz")
        self.assertEqual(status, 200)

        self.holder.set(UPDATING)
        status, headers, body = request(self.port, "GET", "/api/healthz/ready/?x=1")
        self.assertEqual(status, 503)
        self.assertEqual(headers["Retry-After"], "10")
        self.assertEqual(headers["Server"], "LibrePhotos")
        self.assertEqual(json.loads(body), {"status": UPDATING, "version": "1.4.0"})

        self.holder.set(FAILED, "E002")
        _, _, body = request(self.port, "GET", "/api/albums/")
        self.assertEqual(json.loads(body)["reason_code"], "E002")
        _, headers, body = request(self.port, "GET", "/")
        self.assertIn(b"This database belongs to a newer LibrePhotos", body)
        self.assertEqual(headers["Content-Length"], str(len(body)))

    def test_head_has_no_body(self):
        status, headers, body = request(self.port, "HEAD", "/api/healthz/ready")
        self.assertEqual(status, 503)
        self.assertEqual(body, b"")
        self.assertNotEqual(headers["Content-Length"], "0")

    def test_a_login_attempt_gets_the_503_too(self):
        status, _, body = request(
            self.port, "POST", "/api/auth/token/obtain/", b'{"username": "x"}' * 100
        )
        self.assertEqual(status, 503)
        self.assertEqual(json.loads(body)["status"], STARTING)

    def test_stop_frees_the_port(self):
        request(self.port, "GET", "/api/healthz")
        self.server.stop()
        # As the server binds it next (past connections in TIME_WAIT).
        self.assertIsNone(bind_error("127.0.0.1", self.port))
        self.server = MagicMock()


class AddressFamilyTest(SimpleTestCase):
    def test_follows_the_host(self):
        self.assertEqual(startup_page._address_family("127.0.0.1", 0), socket.AF_INET)

    def test_an_unknown_host_falls_back_to_ipv4(self):
        with patch.object(socket, "getaddrinfo", side_effect=OSError("no")):
            self.assertEqual(
                startup_page._address_family("nowhere.invalid", 0), socket.AF_INET
            )


class CommandLineTest(SimpleTestCase):
    def run_main(self, *argv):
        output = StringIO()
        with redirect_stdout(output):
            startup_page.main(list(argv))
        return output.getvalue().strip()

    def test_set_writes_the_phase(self):
        path = temporary_file(self, "status.json")
        self.assertEqual(self.run_main("set", "--status-file", path, UPDATING), "")
        self.assertEqual(startup_page.read_phase_file(path), {"status": UPDATING})

    def test_set_failed_prints_the_reason_code_from_the_log(self):
        path = temporary_file(self, "status.json")
        log = temporary_file(
            self, "command_migrate.log", "?: (librephotos.E001) old database\n"
        )
        printed = self.run_main(
            "set", "--status-file", path, FAILED, "--reason-from", log
        )
        self.assertEqual(printed, "E001")
        self.assertEqual(startup_page.read_phase_file(path)["reason_code"], "E001")

    def test_set_failed_without_a_log_is_unknown(self):
        path = temporary_file(self, "status.json")
        self.assertEqual(self.run_main("set", "--status-file", path, FAILED), "unknown")

    def test_serve_reads_the_status_file_and_the_image_tag(self):
        path = temporary_file(self, "status.json")
        startup_page.write_phase_file(path, UPDATING)
        created = {}

        class FakeServer:
            def __init__(self, address, current_phase, serve_frontend, version):
                created.update(
                    address=address,
                    phase=current_phase(),
                    serve_frontend=serve_frontend,
                    version=version,
                )

            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def serve_forever(self):
                created["served"] = True

        with (
            patch.object(startup_page, "StartupPage", FakeServer),
            patch.dict(os.environ, {"IMAGE_TAG": "1.4.0"}),
        ):
            self.run_main(
                "serve", "--port", "8001", "--status-file", path, "--serve-frontend"
            )
        self.assertEqual(
            created,
            {
                "address": ("0.0.0.0", 8001),
                "phase": {"status": UPDATING},
                "serve_frontend": True,
                "version": "1.4.0",
                "served": True,
            },
        )


class StandaloneStartupPageTest(SimpleTestCase):
    """The Windows app answers on its port from the first second (#2310)."""

    def test_show_page_serves_until_closed(self):
        startup = standalone.Startup()
        with socket.socket() as finder:
            finder.bind(("127.0.0.1", 0))
            port = finder.getsockname()[1]
        startup.show_page("127.0.0.1", port)
        self.addCleanup(startup.close_page)
        startup.set_phase(UPDATING)
        status, _, body = request(port, "GET", "/")
        self.assertEqual(status, 503)
        self.assertIn(b"LibrePhotos is updating", body)
        startup.close_page()
        self.assertIsNone(startup.page)
        self.assertIsNone(bind_error("127.0.0.1", port))

    def test_a_port_taken_meanwhile_is_the_port_message(self):
        with (
            patch.object(
                startup_page,
                "serve_in_thread",
                side_effect=OSError(errno.EADDRINUSE, "in use"),
            ),
            patch("api.runtime.ports.port_owner", return_value=None),
            self.assertRaises(standalone.StartupError) as raised,
        ):
            standalone.Startup().show_page("127.0.0.1", 8000)
        self.assertIn("Port 8000", str(raised.exception))

    def start_and_fail(self, error):
        order = []
        startup = standalone.Startup()
        startup.page = MagicMock()
        startup.page.stop.side_effect = lambda: order.append("page closed")
        with (
            patch.object(standalone, "prepare_environment"),
            patch.object(standalone, "Startup", return_value=startup),
            patch.object(standalone, "run_server", side_effect=error),
            patch.object(
                standalone,
                "_report_failure",
                side_effect=lambda message: order.append(startup.phase()),
            ),
            patch("traceback.print_exc"),
            self.assertRaises(SystemExit),
        ):
            standalone.main(["run"])
        return order

    def test_the_failure_page_stays_until_the_message_box_is_closed(self):
        order = self.start_and_fail(standalone.StartupError("refused", "E002"))
        self.assertEqual(
            order, [{"status": FAILED, "reason_code": "E002"}, "page closed"]
        )

    def test_an_unexpected_error_is_an_unknown_failure(self):
        order = self.start_and_fail(RuntimeError("boom"))
        self.assertEqual(
            order, [{"status": FAILED, "reason_code": "unknown"}, "page closed"]
        )
