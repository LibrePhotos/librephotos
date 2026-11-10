"""The sidecars' HTTP server: one thread, one request at a time, keep-alive.

It must stay single-threaded. A sidecar's ONNX Runtime sessions and the exif
sidecar's ExifTool process are not safe to use from two threads, and a
sidecar sized for one inference would run out of memory on two. gevent's
WSGIServer, which this replaces, served one request at a time too: without
gevent's monkey-patching a request never yielded to another.

What it keeps from gevent's server, as the backend's client sees it
(``api.runtime.sidecars``, a pooled ``requests`` session per process):

* HTTP/1.1 keep-alive. Each of the backend's processes keeps its connection
  open, and the server watches every open connection with ``selectors``,
  answering whichever sends a request next. Closing after every response
  instead would leave a socket in TIME_WAIT per request: about 15,000 after
  20,000 requests on Windows, close to its 16,384 ephemeral ports.
* No request size limit, and a response without a Content-Length goes out
  chunked.
* One access log line per request (gevent wrote them to stderr), through the
  sidecar's logger.

A request is read in full before the app runs, so a request the app leaves
unread cannot be taken for the next one. A client that stops half way through
a request is dropped after ``REQUEST_TIMEOUT_SECONDS``; an idle connection
after ``IDLE_TIMEOUT_SECONDS``. Clients must not pipeline (send a request
before the answer to the last one); urllib3 never does.

``serve()`` stops on SIGTERM (what api.runtime.supervisor sends on Linux)
once the request in hand is answered, within ``POLL_SECONDS`` when idle, and
on SIGINT, closing its sockets. Windows has no SIGTERM for another process to
send: psutil's terminate() ends the process there, as it did with gevent.
"""

from __future__ import annotations

import io
import logging
import selectors
import signal
import socket
import sys
import threading
import time
from collections.abc import Callable
from http.server import BaseHTTPRequestHandler
from types import FrameType
from typing import TYPE_CHECKING, Any
from urllib.parse import unquote_to_bytes

if TYPE_CHECKING:
    from _typeshed import OptExcInfo
    from _typeshed.wsgi import WSGIApplication, WSGIEnvironment

# How long a client may take to send the rest of a request it started, and
# to take an answer. The backend sends whole requests over loopback.
REQUEST_TIMEOUT_SECONDS = 60
# How long an idle keep-alive connection stays open.
IDLE_TIMEOUT_SECONDS = 300
# How often the loop wakes to drop idle connections and notice a stop.
POLL_SECONDS = 1.0


class _Connection(BaseHTTPRequestHandler):
    """One client connection; ``handle_one_request`` answers its next request.

    BaseHTTPRequestHandler parses the request line and headers and decides
    keep-alive (``close_connection``); the WSGI call is ``_run_wsgi``.
    """

    protocol_version = "HTTP/1.1"
    # Headers and body go out as separate writes; with Nagle's algorithm the
    # second waits for the client's delayed ACK (tens of milliseconds).
    disable_nagle_algorithm = True
    timeout = REQUEST_TIMEOUT_SECONDS

    def __init__(
        self, sock: socket.socket, address: tuple[str, int], server: WSGIServer
    ) -> None:
        # Not super().__init__: that would serve the whole connection now.
        self.request = sock
        self.client_address = address
        self.wsgi_server = server
        self.setup()
        self.close_connection = False
        self.last_active = time.monotonic()

    def __getattr__(self, name: str) -> Callable[[], None]:
        # Every method goes to the app (do_GET, do_POST, ...).
        if name.startswith("do_"):
            return self._run_wsgi
        raise AttributeError(name)

    def _body(self) -> bytes:
        if self.headers.get("Transfer-Encoding", "").lower() == "chunked":
            return self._chunked_body()
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length > 0 else b""

    def _chunked_body(self) -> bytes:
        body = bytearray()
        while size := int(self.rfile.readline(65537).split(b";")[0].strip(), 16):
            body += self.rfile.read(size)
            self.rfile.readline()  # the chunk's line break
        while self.rfile.readline(65537) not in (b"\r\n", b"\n", b""):
            pass  # trailers
        return bytes(body)

    def _environ(self, body: bytes) -> WSGIEnvironment:
        path, _, query = self.path.partition("?")
        host, port = self.wsgi_server.address
        environ: WSGIEnvironment = {
            "REQUEST_METHOD": self.command,
            "SCRIPT_NAME": "",
            "PATH_INFO": unquote_to_bytes(path).decode("latin-1"),
            "QUERY_STRING": query,
            "SERVER_NAME": host,
            "SERVER_PORT": str(port),
            "SERVER_PROTOCOL": self.request_version,
            "REMOTE_ADDR": self.client_address[0],
            "REMOTE_PORT": str(self.client_address[1]),
            "CONTENT_LENGTH": str(len(body)),
            "wsgi.version": (1, 0),
            "wsgi.url_scheme": "http",
            "wsgi.input": io.BytesIO(body),
            "wsgi.errors": sys.stderr,
            "wsgi.multithread": False,
            "wsgi.multiprocess": False,
            "wsgi.run_once": False,
            # Read in full above, chunked or not.
            "wsgi.input_terminated": True,
        }
        content_type = self.headers.get("Content-Type")
        if content_type:
            environ["CONTENT_TYPE"] = content_type
        for name, value in self.headers.items():
            key = "HTTP_" + name.upper().replace("-", "_")
            if key in (
                "HTTP_CONTENT_TYPE",
                "HTTP_CONTENT_LENGTH",
                "HTTP_TRANSFER_ENCODING",  # the body is no longer chunked
            ):
                continue
            environ[key] = f"{environ[key]},{value}" if key in environ else value
        return environ

    def _run_wsgi(self) -> None:
        started = time.monotonic()
        environ = self._environ(self._body())
        response = _Response(self)
        result = self.wsgi_server.app(environ, response.start_response)
        try:
            for chunk in result:
                response.write(chunk)
            response.finish()
        finally:
            close = getattr(result, "close", None)
            if close is not None:
                close()  # Flask's teardown_request runs here
        self.wsgi_server.log.info(
            '%s "%s" %s %s %.6f',
            self.client_address[0],
            self.requestline,
            response.status.split(" ", 1)[0],
            response.sent,
            time.monotonic() - started,
        )

    def log_message(self, format: str, *args: Any) -> None:
        # Malformed requests and the like, from BaseHTTPRequestHandler.
        self.wsgi_server.log.warning("%s %s", self.client_address[0], format % args)


class _Response:
    """The WSGI ``start_response``/``write`` side of one request."""

    def __init__(self, connection: _Connection) -> None:
        self._connection = connection
        self.status = ""
        self._headers: list[tuple[str, str]] = []
        self._chunked = False
        self._sent_headers = False
        self.sent = 0

    def start_response(
        self,
        status: str,
        headers: list[tuple[str, str]],
        exc_info: OptExcInfo | None = None,
        /,
    ) -> Callable[[bytes], object]:
        if exc_info is not None and exc_info[1] is not None and self._sent_headers:
            raise exc_info[1].with_traceback(exc_info[2])
        self.status, self._headers = status, headers
        return self.write

    def _send_headers(self) -> None:
        connection = self._connection
        code, _, reason = self.status.partition(" ")
        connection.send_response_only(int(code), reason)
        connection.send_header("Date", connection.date_time_string())
        names = {name.lower() for name, _ in self._headers}
        for name, value in self._headers:
            connection.send_header(name, value)
        no_body = connection.command == "HEAD" or int(code) in (204, 304)
        if "content-length" not in names and not no_body:
            if connection.request_version >= "HTTP/1.1":
                self._chunked = True
                connection.send_header("Transfer-Encoding", "chunked")
            else:
                connection.close_connection = True
        if connection.close_connection:
            connection.send_header("Connection", "close")
        connection.end_headers()
        self._sent_headers = True

    def write(self, data: bytes) -> None:
        if not self._sent_headers:
            self._send_headers()
        if not data:
            return
        wfile = self._connection.wfile
        if self._chunked:
            wfile.write(b"%x\r\n%s\r\n" % (len(data), data))
        else:
            wfile.write(data)
        self.sent += len(data)

    def finish(self) -> None:
        if not self._sent_headers:
            self._send_headers()
        if self._chunked:
            self._connection.wfile.write(b"0\r\n\r\n")


class WSGIServer:
    """Serves ``app`` on ``address``, one request at a time; see the module docstring."""

    def __init__(
        self,
        address: tuple[str, int],
        app: WSGIApplication,
        log: logging.Logger,
    ) -> None:
        self.app = app
        self.log = log
        self._listener = socket.create_server(address, backlog=128)
        self.address: tuple[str, int] = self._listener.getsockname()[:2]
        self._listener.setblocking(False)
        self._selector = selectors.DefaultSelector()
        self._selector.register(self._listener, selectors.EVENT_READ)
        self._stopped = threading.Event()

    def serve_forever(self) -> None:
        """Answer requests until ``stop`` or SIGTERM/SIGINT; then close every socket."""
        restore = _stop_on_sigterm(self._stopped)
        try:
            while not self._stopped.is_set():
                for key, _ in self._selector.select(POLL_SECONDS):
                    if key.fileobj is self._listener:
                        self._accept()
                    else:
                        self._answer(key.data)
                self._drop_idle()
        except KeyboardInterrupt:
            pass
        finally:
            restore()
            self.close()

    def stop(self) -> None:
        """Leave ``serve_forever`` within ``POLL_SECONDS`` (from another thread)."""
        self._stopped.set()

    def close(self) -> None:
        for key in list(self._selector.get_map().values()):
            if isinstance(key.data, _Connection):
                self._close(key.data)
        self._selector.close()
        self._listener.close()

    def _accept(self) -> None:
        try:
            sock, address = self._listener.accept()
        except BlockingIOError, InterruptedError:
            return
        sock.setblocking(True)
        connection = _Connection(sock, address, self)
        self._selector.register(sock, selectors.EVENT_READ, connection)

    def _answer(self, connection: _Connection) -> None:
        try:
            connection.handle_one_request()
            connection.wfile.flush()
        except OSError as error:  # the client went away or timed out
            self.log.debug("dropping a connection: %s", error)
            connection.close_connection = True
        except Exception:
            # Flask answers the app's own errors with a 500; this is a request
            # the server could not handle. Drop its connection, keep serving.
            self.log.exception("could not answer a request")
            connection.close_connection = True
        connection.last_active = time.monotonic()
        if connection.close_connection:
            self._close(connection)

    def _drop_idle(self) -> None:
        cutoff = time.monotonic() - IDLE_TIMEOUT_SECONDS
        for key in list(self._selector.get_map().values()):
            if isinstance(key.data, _Connection) and key.data.last_active < cutoff:
                self._close(key.data)

    def _close(self, connection: _Connection) -> None:
        try:
            self._selector.unregister(connection.request)
        except KeyError, ValueError:
            pass
        try:
            connection.finish()
        except OSError:
            pass
        connection.request.close()


def _stop_on_sigterm(stopped: threading.Event) -> Callable[[], None]:
    """Let SIGTERM stop the loop once the request in hand is answered; the undo.

    Only the main thread may set signal handlers (tests serve from another).
    """
    if threading.current_thread() is not threading.main_thread():
        return lambda: None

    def stop(_signum: int, _frame: FrameType | None) -> None:
        stopped.set()

    previous = signal.signal(signal.SIGTERM, stop)

    def restore() -> None:
        signal.signal(signal.SIGTERM, previous)

    return restore


def serve(
    address: tuple[str, int],
    app: WSGIApplication,
    log: logging.Logger,
) -> None:
    """Serve ``app`` on ``address`` until SIGTERM or SIGINT."""
    WSGIServer(address, app, log).serve_forever()
