import io

from django.test import SimpleTestCase

from api.tests.sidecar_client import test_client
from service._web import App, Response, request


class BoomError(Exception):
    pass


class UnhandledError(Exception):
    pass


def _app():
    app = App("probe")
    seen = {"before": [], "teardown": []}

    @app.before_request
    def before():
        seen["before"].append((request.method, request.path, request.endpoint))

    @app.teardown_request
    def teardown(error):
        seen["teardown"].append(error)

    @app.route("/items/", methods=["POST"])
    def add_item():
        return {"body": request.get_json(silent=True)}

    @app.route("/items/", methods=["DELETE"])
    def delete_item():
        return {"deleted": True}, 202

    @app.get("/text")
    def text():
        return "plain", 201

    @app.get("/list")
    def listing():
        return [1, 2, 3]

    @app.get("/boom")
    def boom():
        raise BoomError("model missing")

    @app.get("/unhandled")
    def unhandled():
        raise UnhandledError("no handler")

    @app.get("/stream")
    def stream():
        return Response(part for part in (b"a", b"b"))

    @app.errorhandler(BoomError)
    def on_boom(error):
        return {"error": str(error)}, 500

    app.config["seen"] = seen
    return app


class RoutingTest(SimpleTestCase):
    def setUp(self):
        self.app = _app()
        self.client = test_client(self.app)

    def test_one_path_answers_each_method_with_its_view(self):
        added = self.client.post("/items/", json={"a": 1})
        deleted = self.client.delete("/items/", json={})

        self.assertEqual(
            (200, {"body": {"a": 1}}), (added.status_code, added.get_json())
        )
        self.assertEqual((202, {"deleted": True}), (deleted.status_code, deleted.json))

    def test_an_unknown_path_is_404_and_a_wrong_method_405(self):
        self.assertEqual(404, self.client.get("/nowhere").status_code)
        self.assertEqual(405, self.client.get("/items/").status_code)

    def test_a_path_without_its_slash_is_redirected(self):
        response = self.client.post("/items", json={})

        self.assertEqual(308, response.status_code)
        self.assertEqual("/items/", response.headers["Location"])

    def test_bodies_and_statuses(self):
        text = self.client.get("/text")
        listing = self.client.get("/list")

        self.assertEqual(
            (201, "plain"), (text.status_code, text.get_data(as_text=True))
        )
        self.assertIsNone(text.get_json())
        self.assertEqual([1, 2, 3], listing.get_json())
        self.assertEqual(b"ab", self.client.get("/stream").data)

    def test_a_body_that_is_not_json_reads_as_none_when_silent(self):
        response = self.client.post("/items/", data="{}", content_type="text/plain")
        broken = self.client.post(
            "/items/", data="{oops", content_type="application/json"
        )

        self.assertEqual({"body": None}, response.get_json())
        self.assertEqual({"body": None}, broken.get_json())

    def test_hooks_see_the_endpoint_and_run_for_every_request(self):
        self.client.post("/items/", json={})
        self.client.get("/nowhere")

        seen = self.app.config["seen"]
        self.assertEqual(
            [("POST", "/items/", "add_item"), ("GET", "/nowhere", None)],
            seen["before"],
        )
        self.assertEqual([None, None], seen["teardown"])


class ErrorHandlerTest(SimpleTestCase):
    def setUp(self):
        self.app = _app()
        self.client = test_client(self.app)

    def test_a_handled_exception_is_answered_and_seen_by_teardown(self):
        response = self.client.get("/boom")

        self.assertEqual(500, response.status_code)
        self.assertEqual({"error": "model missing"}, response.get_json())
        (error,) = self.app.config["seen"]["teardown"]
        self.assertIsInstance(error, BoomError)

    def test_an_unhandled_exception_propagates_after_teardown(self):
        with self.assertRaises(UnhandledError):
            self.client.get("/unhandled")
        self.assertEqual(1, len(self.app.config["seen"]["teardown"]))


class WsgiTest(SimpleTestCase):
    def call(self, method, path, body=b""):
        captured = {}

        def start_response(status, headers, exc_info=None):
            captured["status"], captured["headers"] = status, dict(headers)

        environ = {
            "REQUEST_METHOD": method,
            "PATH_INFO": path,
            "CONTENT_LENGTH": str(len(body)),
            "CONTENT_TYPE": "application/json",
            "wsgi.input": io.BytesIO(body),
        }
        chunks = list(_app()(environ, start_response))
        return captured, b"".join(chunks)

    def test_a_json_answer_has_its_length_and_type(self):
        captured, body = self.call("POST", "/items/", b'{"a": 1}')

        self.assertEqual("200 OK", captured["status"])
        self.assertEqual("application/json", captured["headers"]["Content-Type"])
        self.assertEqual(str(len(body)), captured["headers"]["Content-Length"])

    def test_head_answers_the_headers_of_get_without_a_body(self):
        captured, body = self.call("HEAD", "/text")

        self.assertEqual("201 Created", captured["status"])
        self.assertEqual("5", captured["headers"]["Content-Length"])
        self.assertEqual(b"", body)

    def test_a_streamed_answer_has_no_length(self):
        captured, body = self.call("GET", "/stream")

        self.assertNotIn("Content-Length", captured["headers"])
        self.assertEqual(b"ab", body)
