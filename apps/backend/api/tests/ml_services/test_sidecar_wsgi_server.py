"""The sidecars' HTTP server (service/_wsgi_server.py), over real sockets.

One thread, one request at a time, HTTP/1.1 keep-alive for the backend's
pooled clients, full request bodies, chunked answers without a length, one
access log line per request, and a clean stop.
"""

import json
import os
import signal
import socket
import subprocess
import sys
import threading
import time
import unittest
from pathlib import Path
from unittest.mock import patch

import requests
from django.test import SimpleTestCase
from flask import Response, request

from api.runtime.sidecars import _retry_policy
from service import _wsgi_server
from service._common import create_app, logger
from service._wsgi_server import WSGIServer

BACKEND = Path(__file__).resolve().parents[3]


def _app():
    app = create_app("wsgi-test")
    state = {"running": 0, "most": 0}

    @app.post("/echo")
    def echo():
        body = request.get_data()
        return {"length": len(body), "json": request.get_json(silent=True)}

    @app.get("/slow")
    def slow():
        state["running"] += 1
        state["most"] = max(state["most"], state["running"])
        time.sleep(0.2)
        state["running"] -= 1
        return {"most": state["most"]}

    @app.get("/stream")
    def stream():
        return Response(part for part in (b"one,", b"two,", b"three"))

    app.config["state"] = state
    return app


class ServerTestCase(SimpleTestCase):
    def setUp(self):
        self.app = _app()
        self.log = logger("wsgi-test")
        self.server = WSGIServer(("127.0.0.1", 0), self.app, self.log)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.addCleanup(self.stop)
        host, port = self.server.address
        self.url = f"http://{host}:{port}"

    def stop(self):
        self.server.stop()
        self.thread.join(10)

    def session(self):
        session = requests.Session()
        session.mount(
            "http://", requests.adapters.HTTPAdapter(max_retries=_retry_policy())
        )
        self.addCleanup(session.close)
        return session

    def connections(self):
        return len(self.server._selector.get_map()) - 1  # minus the listener


class KeepAliveTest(ServerTestCase):
    def test_a_pooled_client_keeps_one_connection(self):
        session = self.session()
        for _ in range(20):
            self.assertEqual(session.get(f"{self.url}/health").status_code, 200)
        self.assertEqual(self.connections(), 1)

    def test_clients_that_keep_their_connections_open_are_all_answered(self):
        first, second = self.session(), self.session()
        for _ in range(5):
            self.assertEqual(first.get(f"{self.url}/health").status_code, 200)
            self.assertEqual(second.get(f"{self.url}/health").status_code, 200)
        self.assertEqual(self.connections(), 2)

    def test_a_connection_idle_too_long_is_closed_and_the_client_reconnects(self):
        session = self.session()
        session.get(f"{self.url}/health")
        with patch.object(_wsgi_server, "IDLE_TIMEOUT_SECONDS", 0):
            deadline = time.monotonic() + 5
            while self.connections() and time.monotonic() < deadline:
                time.sleep(0.05)
        self.assertEqual(self.connections(), 0)
        self.assertEqual(session.get(f"{self.url}/health").status_code, 200)


class OneRequestAtATimeTest(ServerTestCase):
    def test_requests_from_several_clients_never_overlap(self):
        answers = []

        def ask():
            answers.append(self.session().get(f"{self.url}/slow").json()["most"])

        threads = [threading.Thread(target=ask) for _ in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(30)
        self.assertEqual(answers, [1, 1, 1, 1])


class RequestsAndAnswersTest(ServerTestCase):
    def test_a_large_body_arrives_whole(self):
        vectors = [[0.123456789] * 512 for _ in range(2000)]  # ~25 MB of JSON
        response = self.session().post(f"{self.url}/echo", json={"v": vectors})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["json"], {"v": vectors})

    def test_a_chunked_request_body(self):
        body = (part for part in (b'{"a": ', b"[1, 2, 3]}"))
        response = self.session().post(
            f"{self.url}/echo", data=body, headers={"Content-Type": "application/json"}
        )
        self.assertEqual(response.json(), {"length": 16, "json": {"a": [1, 2, 3]}})

    def test_an_answer_without_a_length_goes_out_chunked(self):
        response = self.session().get(f"{self.url}/stream")
        self.assertEqual(response.headers.get("Transfer-Encoding"), "chunked")
        self.assertEqual(response.content, b"one,two,three")
        # The connection is still usable.
        self.assertEqual(self.session().get(f"{self.url}/health").status_code, 200)

    def test_a_request_is_over_when_flask_says_so(self):
        # /health reports busy while a request runs: the teardown ran.
        session = self.session()
        session.post(f"{self.url}/echo", json={})
        self.assertFalse(session.get(f"{self.url}/health").json()["busy"])

    def test_errors_keep_their_status_and_the_server_keeps_serving(self):
        session = self.session()
        self.assertEqual(session.get(f"{self.url}/nowhere").status_code, 404)
        with socket.create_connection(self.server.address) as raw:
            raw.sendall(b"NOT HTTP\r\n\r\n")
            self.assertIn(b" 400 ", raw.recv(1024))
        self.assertEqual(session.get(f"{self.url}/health").status_code, 200)

    def test_one_access_log_line_per_request(self):
        session = self.session()
        with self.assertLogs("wsgi-test", "INFO") as logs:
            session.get(f"{self.url}/health")
            session.post(f"{self.url}/echo", json={})
            # The server logs once the answer is out, so the last line may
            # still be on its way.
            deadline = time.monotonic() + 5
            while len(logs.records) < 2 and time.monotonic() < deadline:
                time.sleep(0.01)
        lines = [line for line in logs.output if "HTTP/1.1" in line]
        self.assertEqual(len(lines), 2)
        self.assertIn('"GET /health HTTP/1.1" 200', lines[0])

    def test_a_stalled_client_is_dropped_and_the_others_answered(self):
        with patch.object(_wsgi_server._Connection, "timeout", 0.5):
            stalled = socket.create_connection(self.server.address)
            self.addCleanup(stalled.close)
            stalled.sendall(b"POST /echo HTTP/1.1\r\nContent-Length: 100\r\n\r\n{")
            time.sleep(0.1)
            started = time.monotonic()
            self.assertEqual(self.session().get(f"{self.url}/health").status_code, 200)
            self.assertLess(time.monotonic() - started, 5)


class StopTest(SimpleTestCase):
    def test_stop_closes_the_port(self):
        server = WSGIServer(("127.0.0.1", 0), _app(), logger("wsgi-test"))
        address = server.address
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        requests.get(f"http://{address[0]}:{address[1]}/health", timeout=5)
        server.stop()
        thread.join(10)
        self.assertFalse(thread.is_alive())
        with self.assertRaises(OSError):
            socket.create_connection(address, timeout=1)

    @unittest.skipUnless(os.name == "posix", "SIGTERM from another process is POSIX")
    def test_sigterm_stops_the_server(self):
        child = subprocess.Popen(
            [
                sys.executable,
                "-c",
                "import sys; from service._common import create_app, logger;"
                "from service._wsgi_server import WSGIServer;"
                "s = WSGIServer(('127.0.0.1', 0), create_app('t'), logger('t'));"
                "print(s.address[1], flush=True); s.serve_forever(); print('stopped')",
            ],
            cwd=BACKEND,
            env={**os.environ, "PYTHONPATH": str(BACKEND)},
            stdout=subprocess.PIPE,
            text=True,
        )
        port = int(child.stdout.readline())
        requests.get(f"http://127.0.0.1:{port}/health", timeout=5)
        child.send_signal(signal.SIGTERM)
        output, _ = child.communicate(timeout=10)
        self.assertEqual(child.returncode, 0)
        self.assertIn("stopped", output)


class JsonRoundTripTest(ServerTestCase):
    def test_unicode_and_query_strings(self):
        body = {"name": "Zoë 日本 📷"}
        response = self.session().post(f"{self.url}/echo?x=1", json=body)
        self.assertEqual(response.json()["json"], body)
        self.assertEqual(json.loads(response.content)["length"], len(json.dumps(body)))
