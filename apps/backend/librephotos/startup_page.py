"""The placeholder that answers on the server's port until the server does (#2310).

Before uvicorn starts, the Docker entrypoint and the Windows app back up and
migrate the database and start the services, which can take many minutes after
an update. Nothing listened on the port during all of that: the proxy answered
502, the single container and the Windows app "connection refused", and a
failed update looked exactly the same, forever. This server takes the port
for that time and says what is going on:

* ``/api/healthz`` (liveness): 200. The process answers, and a long migration
  is not mistaken for a hung container (the Kubernetes startup probe).
* ``/api/healthz/ready`` and every other ``/api/`` or ``/media/`` path: 503
  with ``{"status": "starting" | "updating" | "failed", "reason_code"?,
  "version"?}`` and ``Retry-After``. The web app's BackendStatusGate reads it.
* Any other path, only where the server also serves the web app (the single
  container and the Windows app): a 503 page with the same message that
  reloads into the app once the server is ready. Elsewhere the frontend
  container serves the web app, and the gate shows the message.

Only fixed values leave this server: the three statuses, the reason codes
``E001`` / ``E002`` / ``unknown`` and the release. The requests are anonymous,
so no exception text, path or database detail is ever part of an answer.

Standard library only, imported by nothing that needs Django: the entrypoint
starts it before anything else, and the Nuitka build compiles it in with the
page below as a string (no data files).

    python -m librephotos.startup_page serve --port 8001 --status-file F [--serve-frontend]
    python -m librephotos.startup_page set --status-file F updating
    python -m librephotos.startup_page set --status-file F failed --reason-from command_migrate.log

``serve`` reads the phase from the status file on every request; ``set``
writes it (atomically) and prints the reason code it stored.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import html
import json
import os
import re
import socket
import socketserver
import sys
import threading
from collections.abc import Callable, Iterable, Sequence
from dataclasses import dataclass, field
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from librephotos.env import env_str

STARTING = "starting"
UPDATING = "updating"
FAILED = "failed"
STATUSES = (STARTING, UPDATING, FAILED)
UNKNOWN = "unknown"
# The failures with a text of their own (api/checks.py); anything else is unknown.
KNOWN_REASON_CODES = ("E001", "E002")
REASON_CODES = (*KNOWN_REASON_CODES, UNKNOWN)
RETRY_AFTER_SECONDS = 10
# A request body is read and dropped before the answer, so the client does not
# get a reset instead of the 503; beyond this the connection is just closed.
_MAX_DISCARDED_BODY = 1 << 20
_REQUEST_TIMEOUT_SECONDS = 10
# "?: (librephotos.E002) The database ..." in migrate's output.
_CHECK_ID = re.compile(r"\blibrephotos\.(E\d{3})\b")
_VERSION = re.compile(r"^[A-Za-z0-9._+-]{1,64}$")
_API_PREFIXES = ("/api/", "/media/")
_LIVENESS = "/api/healthz"

Phase = dict[str, str]


def phase(status: str | None, reason_code: str | None = None) -> Phase:
    """What a 503 says, from fixed values only: an unknown status reads as
    starting, and a failure's reason code is one of REASON_CODES."""
    if status not in STATUSES:
        status = STARTING
    body = {"status": status}
    if status == FAILED:
        body["reason_code"] = reason_code if reason_code in REASON_CODES else UNKNOWN
    return body


def reason_code(lines: Iterable[str]) -> str:
    """The last of LibrePhotos' own check errors a failed command printed
    (librephotos.E001 / E002), or ``unknown``."""
    found = UNKNOWN
    for line in lines:
        for code in _CHECK_ID.findall(line):
            found = code if code in KNOWN_REASON_CODES else UNKNOWN
    return found


def reason_code_from_file(path: str) -> str:
    try:
        with open(path, encoding="utf-8", errors="replace") as handle:
            return reason_code(handle)
    except OSError:
        return UNKNOWN


def read_phase_file(path: str) -> Phase:
    """The phase in the status file; ``starting`` while it is missing or unreadable."""
    try:
        with open(path, encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return phase(STARTING)
    if not isinstance(data, dict):
        return phase(STARTING)
    return phase(data.get("status"), data.get("reason_code"))


def write_phase_file(path: str, status: str, reason: str | None = None) -> Phase:
    """Replace the status file in one step, so a reader never sees half of it."""
    body = phase(status, reason)
    temporary = f"{path}.tmp"
    with open(temporary, "w", encoding="utf-8") as handle:
        json.dump(body, handle)
    os.replace(temporary, path)
    return body


class PhaseHolder:
    """The phase of a placeholder in the same process (the Windows app)."""

    def __init__(self) -> None:
        self._phase = phase(STARTING)

    def set(self, status: str, reason: str | None = None) -> None:
        # One reference swap: request threads see the old phase or the new one.
        self._phase = phase(status, reason)

    def __call__(self) -> Phase:
        return dict(self._phase)


def clean_version(version: str | None) -> str | None:
    """The release as the answer may carry it: a plain tag, or nothing."""
    if version and _VERSION.match(version):
        return version
    return None


# --------------------------------------------------------------------- page

DOCS = "https://docs.librephotos.com/docs/installation/upgrading"

# The web app's texts (apps/frontend/src/locales/en/translation.json,
# backendStatus.*), so both screens say the same; a test keeps them equal.
TEXTS: dict[str, dict[str, str]] = {
    UPDATING: {
        "title": "LibrePhotos is updating",
        "text": "Your photos are safe. This can take a few minutes on large "
        "libraries. This page reloads by itself.",
        "tab": "Updating · LibrePhotos",
    },
    STARTING: {
        "title": "LibrePhotos is starting",
        "text": "LibrePhotos is starting its services. This usually takes a few "
        "seconds, and this page reloads by itself.",
        "tab": "Starting · LibrePhotos",
    },
    "E001": {
        "title": "This LibrePhotos is too old to update in one step",
        "text": "Your photos and settings are unchanged. Install version 1.1.0 "
        "first, start it once, then update again.",
        "details": "The database is older than LibrePhotos 2026w10, the oldest "
        "release this version can update from (reason code E001).",
        "docs": f"{DOCS}#old-releases",
        "tab": "Update failed · LibrePhotos",
    },
    "E002": {
        "title": "This database belongs to a newer LibrePhotos",
        "text": "Your photos and settings are unchanged. The database was already "
        "updated by a newer release. Install that release or a newer one again.",
        "details": "A newer LibrePhotos release has already updated this database, "
        "and this older release cannot run on it (reason code E002).",
        "docs": f"{DOCS}#downgrade",
        "tab": "Update failed · LibrePhotos",
    },
    UNKNOWN: {
        "title": "The update could not finish",
        "text": "LibrePhotos did not start. Your photos are unchanged. The reason "
        "is in the logs folder: command_migrate.log (Docker) or console.log "
        "(Windows app).",
        "details": "The database update stopped with an error. The log named "
        "above says which step failed and why.",
        "docs": f"{DOCS}#updating-screen",
        "tab": "Update failed · LibrePhotos",
    },
}
SLOW_TEXT = (
    "Still working? Large libraries can take longer. If nothing changes for an "
    "hour, ask the person who set up LibrePhotos to look at the log."
)


def _texts_key(current: Phase) -> str:
    if current["status"] == FAILED:
        return current["reason_code"]
    return current["status"]


# The LibrePhotos logo (three stacked diamonds, apps/frontend/public/logo.png)
# drawn in the text colour, so it works in dark mode too.
_LOGO = (
    '<svg class="logo" viewBox="0 0 1300 1300" aria-hidden="true" fill="none" '
    'stroke="currentColor" stroke-width="31">'
    '<path d="M648 55 1148 553 648 1050 148 553Z"/>'
    '<path d="M648 148 1148 648 648 1145 148 648Z"/>'
    '<path d="M648 243 1148 743 648 1240 148 743Z"/></svg>'
)

_STYLE = """
:root{color-scheme:light dark;--bg:#f8f9fa;--text:#1a1b1e;--dim:#868e96;--blue:#228be6;
--orange:#f76707;--red:#fa5252;--line:#dee2e6}
@media (prefers-color-scheme:dark){:root{--bg:#1f1f1f;--text:#c9c9c9;--dim:#909296;
--blue:#4dabf7;--orange:#ff922b;--red:#ff8787;--line:#424242}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 -apple-system,
BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
main{max-width:520px;margin:0 auto;padding:80px 16px 32px;text-align:center}
.brand{display:flex;gap:8px;align-items:center;justify-content:center;font-weight:700;
font-size:18px}
.logo{width:48px;height:48px}
.icon{width:80px;height:80px;margin:24px auto 8px;border-radius:50%;display:grid;
place-items:center;color:var(--blue);background:color-mix(in srgb,currentColor 12%,transparent)}
.spin{width:36px;height:36px;border:4px solid currentColor;border-right-color:transparent;
border-radius:50%;animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
@media (prefers-reduced-motion:reduce){.spin{animation:none}}
.mark{font-size:40px;font-weight:700;line-height:1}
body[data-status=failed] .icon{color:var(--orange)}
body[data-reason=unknown] .icon{color:var(--red)}
body[data-status=failed] .spin,body:not([data-status=failed]) .mark{display:none}
h1{font-size:26px;line-height:1.3;margin:8px 0}
p{margin:8px 0}
.dim{color:var(--dim)}
.slow{border:1px solid var(--line);border-radius:4px;padding:8px 12px;text-align:left}
a.guide{display:inline-block;margin-top:8px;padding:8px 18px;border-radius:4px;
background:#1971c2;color:#fff;font-weight:600;text-decoration:none}
details{margin-top:16px;text-align:left;border-top:1px solid var(--line);padding-top:8px}
summary{cursor:pointer}
[hidden]{display:none!important}
"""

# Polls readiness every 5 s like the web app's gate: a 200 (or any answer that
# is not the placeholder's) reloads into the app, a 503 from here updates the
# texts, and no answer at all (the seconds between the placeholder and the
# server) just waits for the next try. Constant, so its hash goes into the CSP.
_SCRIPT = """
(function () {
  var TEXTS = JSON.parse(document.getElementById("texts").textContent);
  var body = document.body;
  var since = Date.now();
  function key(s) { return s.status === "failed" ? (s.reason_code || "unknown") : s.status; }
  function show(s) {
    var t = TEXTS[key(s)] || TEXTS.unknown;
    body.dataset.status = s.status;
    body.dataset.reason = s.status === "failed" ? key(s) : "";
    document.title = t.tab;
    document.getElementById("title").textContent = t.title;
    document.getElementById("text").textContent = t.text;
    var failed = s.status === "failed";
    document.getElementById("failure").hidden = !failed;
    document.getElementById("waiting").hidden = failed;
    if (failed) {
      document.getElementById("details").textContent = t.details;
      document.getElementById("code").textContent = key(s);
      document.getElementById("guide").href = t.docs;
    }
    document.getElementById("main").setAttribute("role", failed ? "alert" : "status");
  }
  function tick() {
    var minutes = Math.floor((Date.now() - since) / 60000);
    document.getElementById("slow").hidden = minutes < 15 || body.dataset.status === "failed";
    document.getElementById("elapsed").textContent =
      (body.dataset.status === "updating" ? "Updating for " : "Waiting for ") +
      (minutes < 1 ? "less than a minute" : minutes + " min");
  }
  function check() {
    fetch("/api/healthz/ready/", { cache: "no-store", credentials: "omit" })
      .then(function (response) {
        if (response.status === 502 || response.status === 504) return;
        if (response.status !== 503) { window.location.reload(); return; }
        return response.json().then(function (s) {
          if (s && TEXTS[key(s)]) show(s);
        }, function () {});
      }, function () {})
      .then(function () { tick(); window.setTimeout(check, 5000); });
  }
  tick();
  window.setTimeout(check, 5000);
})();
"""


def _csp_hash(source: str) -> str:
    digest = hashlib.sha256(source.encode("utf-8")).digest()
    return "'sha256-" + base64.b64encode(digest).decode("ascii") + "'"


# Nothing on the page comes from anywhere but this module: inline style and
# script are allowed by hash, everything else only from this origin.
CONTENT_SECURITY_POLICY = (
    "default-src 'none'; "
    f"style-src {_csp_hash(_STYLE)}; "
    f"script-src {_csp_hash(_SCRIPT)}; "
    "connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
)

_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>{tab}</title>
<noscript><meta http-equiv="refresh" content="10"></noscript>
<style>{style}</style>
</head>
<body data-status="{status}" data-reason="{reason}">
<main id="main" role="{role}" aria-live="polite">
<div class="brand">{logo}<span>LibrePhotos</span></div>
<div class="icon" aria-hidden="true"><div class="spin"></div><div class="mark">!</div></div>
<h1 id="title">{title}</h1>
<p id="text" class="dim">{text}</p>
<div id="waiting"{waiting_hidden}>
<p id="slow" class="slow" hidden>{slow}</p>
<p id="elapsed" class="dim"></p>
</div>
<div id="failure"{failure_hidden}>
<a id="guide" class="guide" href="{docs}">Open the upgrade guide</a>
<details><summary>For the person who runs this server</summary>
<p id="details">{details}</p>
<p>Reason code: <code id="code">{code}</code></p>
</details>
</div>
</main>
<script type="application/json" id="texts">{texts}</script>
<script>{script}</script>
</body>
</html>
"""


def render_page(current: Phase) -> str:
    """The HTML page for a phase. Every value is a constant of this module."""
    failed = current["status"] == FAILED
    texts = TEXTS[_texts_key(current)]
    code = current.get("reason_code", "")
    values = {
        "tab": texts["tab"],
        "status": current["status"],
        "reason": code,
        "role": "alert" if failed else "status",
        "title": texts["title"],
        "text": texts["text"],
        "slow": SLOW_TEXT,
        "docs": texts.get("docs", DOCS),
        "details": texts.get("details", ""),
        "code": code,
    }
    escaped = {name: html.escape(value) for name, value in values.items()}
    # "</" cannot end the JSON block early: json.dumps escapes no "/", so do it here.
    texts_json = json.dumps(TEXTS).replace("</", "<\\/")
    return _PAGE.format(
        **escaped,
        waiting_hidden=" hidden" if failed else "",
        failure_hidden="" if failed else " hidden",
        logo=_LOGO,
        style=_STYLE,
        script=_SCRIPT,
        texts=texts_json,
    )


# ----------------------------------------------------------------- answers


@dataclass(frozen=True)
class Answer:
    status: int
    content_type: str
    body: bytes
    headers: dict[str, str] = field(default_factory=dict)


_NO_STORE = {"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"}


def _json(status: int, body: dict[str, object], headers: dict[str, str]) -> Answer:
    return Answer(
        status,
        "application/json",
        json.dumps(body).encode("utf-8"),
        {**_NO_STORE, **headers},
    )


def _is_api(path: str) -> bool:
    return path in ("/api", "/media") or path.startswith(_API_PREFIXES)


def answer(
    path: str, current: Phase, serve_frontend: bool, version: str | None
) -> Answer:
    """What the placeholder answers to a request for ``path`` (no query string)."""
    if path.rstrip("/") == _LIVENESS:
        return _json(200, {"status": "ok", "starting": True}, {})
    retry = {"Retry-After": str(RETRY_AFTER_SECONDS)}
    if serve_frontend and not _is_api(path):
        page = render_page(current).encode("utf-8")
        headers = {
            **_NO_STORE,
            **retry,
            "Content-Security-Policy": CONTENT_SECURITY_POLICY,
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "no-referrer",
        }
        return Answer(503, "text/html; charset=utf-8", page, headers)
    body: dict[str, object] = dict(current)
    if version:
        body["version"] = version
    return _json(503, body, retry)


# ------------------------------------------------------------------ server


class StartupPage(ThreadingHTTPServer):
    """The placeholder server. ``current_phase`` is asked on every request."""

    daemon_threads = True
    # On Windows SO_REUSEADDR would let it share a port another program holds
    # (as api.runtime.ports.bind_error explains); elsewhere it lets the server
    # bind right after the placeholder closed, past connections in TIME_WAIT.
    allow_reuse_address = sys.platform != "win32"

    def __init__(
        self,
        address: tuple[str, int],
        current_phase: Callable[[], Phase],
        serve_frontend: bool = False,
        version: str | None = None,
    ) -> None:
        self.current_phase = current_phase
        self.serve_frontend = serve_frontend
        self.version = clean_version(version)
        self.address_family = _address_family(*address)
        super().__init__(address, _Handler)

    def server_bind(self) -> None:
        # HTTPServer's own also looks up the host's FQDN, which can hang on a
        # reverse DNS lookup for seconds; nothing here uses the name.
        socketserver.TCPServer.server_bind(self)
        host, port = self.server_address[:2]
        self.server_name = str(host)
        self.server_port = int(port)

    def stop(self) -> None:
        """Stop answering and free the port."""
        self.shutdown()
        self.server_close()


def _address_family(host: str, port: int) -> socket.AddressFamily:
    try:
        return socket.getaddrinfo(
            host, port, type=socket.SOCK_STREAM, flags=socket.AI_PASSIVE
        )[0][0]
    except OSError:
        # Binding then fails and says why.
        return socket.AF_INET


class _Handler(BaseHTTPRequestHandler):
    server: StartupPage
    timeout = _REQUEST_TIMEOUT_SECONDS

    def version_string(self) -> str:
        return "LibrePhotos"

    def log_message(self, format: str, *args: object) -> None:
        # The healthchecks ask every few seconds; their lines would bury the
        # migration's output in docker logs.
        return

    def do_GET(self) -> None:
        self._answer(send_body=True)

    def do_HEAD(self) -> None:
        self._answer(send_body=False)

    # A login attempt or an upload gets the same 503 as a read.
    def do_POST(self) -> None:
        self._other_method()

    def do_PUT(self) -> None:
        self._other_method()

    def do_PATCH(self) -> None:
        self._other_method()

    def do_DELETE(self) -> None:
        self._other_method()

    def do_OPTIONS(self) -> None:
        self._other_method()

    def _other_method(self) -> None:
        self._discard_body()
        self._answer(send_body=True)

    def _discard_body(self) -> None:
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            length = 0
        if 0 < length <= _MAX_DISCARDED_BODY:
            self.rfile.read(length)

    def _answer(self, send_body: bool) -> None:
        server = self.server
        result = answer(
            urlsplit(self.path).path or "/",
            server.current_phase(),
            server.serve_frontend,
            server.version,
        )
        self.send_response(result.status)
        self.send_header("Content-Type", result.content_type)
        self.send_header("Content-Length", str(len(result.body)))
        for name, value in result.headers.items():
            self.send_header(name, value)
        self.end_headers()
        if send_body:
            self.wfile.write(result.body)


def serve_in_thread(
    host: str,
    port: int,
    current_phase: Callable[[], Phase],
    serve_frontend: bool = False,
    version: str | None = None,
) -> StartupPage:
    """Start the placeholder in a daemon thread; ``stop()`` it to free the port.
    Raises OSError when the port cannot be bound."""
    server = StartupPage((host, port), current_phase, serve_frontend, version)
    threading.Thread(
        target=server.serve_forever,
        kwargs={"poll_interval": 0.2},
        name="startup-page",
        daemon=True,
    ).start()
    return server


# --------------------------------------------------------------------- CLI


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="python -m librephotos.startup_page",
        description="Answer on the server's port while LibrePhotos starts.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    serve = sub.add_parser("serve", help="answer until stopped")
    serve.add_argument("--host", default="0.0.0.0")
    serve.add_argument("--port", type=int, required=True)
    serve.add_argument("--status-file", required=True)
    serve.add_argument(
        "--serve-frontend",
        action="store_true",
        help="answer pages outside /api/ with the HTML page",
    )

    update = sub.add_parser("set", help="write the phase; prints the reason code")
    update.add_argument("--status-file", required=True)
    update.add_argument("status", choices=STATUSES)
    update.add_argument(
        "--reason-from",
        metavar="LOG",
        help="for failed: the failed command's output, searched for librephotos.E0xx",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    args = build_parser().parse_args(argv)
    if args.command == "set":
        reason = reason_code_from_file(args.reason_from) if args.reason_from else None
        written = write_phase_file(args.status_file, args.status, reason)
        sys.stdout.write(written.get("reason_code", "") + "\n")
        return
    status_file = args.status_file
    server = StartupPage(
        (args.host, args.port),
        lambda: read_phase_file(status_file),
        args.serve_frontend,
        # The images' build argument; the version endpoint reports the same.
        env_str("IMAGE_TAG"),
    )
    with server:
        server.serve_forever()


if __name__ == "__main__":
    main()
