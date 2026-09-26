"""The app every sidecar is built on (service/_common.py).

/health, the idle clock the watchdog reads, /unload-model, request parsing and
the port and host the sidecar binds to used to be copied into eight main.py
files, each a little different: /health answered {"status": "OK"} on some,
{"last_request_time": ...} on others and {"status": true} under /health/ on
image_similarity.
"""

import os
from unittest.mock import patch

from django.test import SimpleTestCase

from api.sidecars import SERVICES
from service import _common


def _app(**kwargs):
    app = _common.create_app("probe", **kwargs)
    app.config["TESTING"] = True

    @app.route("/work", methods=["POST"])
    def work():
        (value, flag) = _common.json_fields("value", flag="default")
        return {"value": value, "flag": flag}, 200

    @app.route("/boom", methods=["POST"])
    def boom():
        raise RuntimeError("model file missing")

    return app


class HealthTest(SimpleTestCase):
    def test_every_sidecar_answers_the_same_shape(self):
        response = _app().test_client().get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.get_json(),
            {
                "status": "OK",
                "service": "probe",
                "last_request_time": None,
                "model_loaded": None,
                "busy": False,
            },
        )

    def test_the_trailing_slash_image_similarity_used_still_answers(self):
        self.assertEqual(_app().test_client().get("/health/").status_code, 200)

    def test_model_loaded_comes_from_the_sidecar(self):
        loaded = {"yes": True}
        app = _app(unload=lambda: None, is_loaded=lambda: loaded["yes"])

        self.assertIs(app.test_client().get("/health").get_json()["model_loaded"], True)
        loaded["yes"] = False
        self.assertIs(
            app.test_client().get("/health").get_json()["model_loaded"], False
        )


class IdleClockTest(SimpleTestCase):
    def test_a_request_is_stamped_when_it_starts(self):
        app = _app()
        with patch("service._common.time.time", return_value=1234.5):
            app.test_client().post("/work", json={"value": 1})

        self.assertEqual(_common.last_request_time(app), 1234.5)
        self.assertEqual(
            app.test_client().get("/health").get_json()["last_request_time"], 1234.5
        )

    def test_a_rejected_request_still_counts(self):
        app = _app()
        app.test_client().post("/work", json={})

        self.assertIsNotNone(_common.last_request_time(app))

    def test_the_watchdog_itself_does_not_count(self):
        app = _app(unload=lambda: None)
        client = app.test_client()
        client.get("/health")
        client.get("/unload-model")

        self.assertIsNone(_common.last_request_time(app))


class BusyTest(SimpleTestCase):
    def test_a_running_request_is_busy_and_blocks_an_unload(self):
        seen = {}
        unloads = []
        app = _app(unload=lambda: unloads.append(1))

        @app.route("/slow", methods=["POST"])
        def slow():
            # What the watchdog would see mid-inference.
            client = app.test_client()
            seen["health"] = client.get("/health").get_json()
            seen["unload"] = client.get("/unload-model").status_code
            return {}, 200

        client = app.test_client()
        client.post("/slow")

        self.assertIs(seen["health"]["busy"], True)
        self.assertEqual(seen["unload"], 409)
        self.assertEqual(unloads, [])
        self.assertIs(client.get("/health").get_json()["busy"], False)

    def test_a_failed_request_is_not_left_running(self):
        app = _app()
        app.test_client().post("/boom")
        app.test_client().post("/work", json={})

        self.assertIs(app.test_client().get("/health").get_json()["busy"], False)


class UnloadModelTest(SimpleTestCase):
    def test_only_a_sidecar_with_a_model_offers_it(self):
        self.assertEqual(_app().test_client().get("/unload-model").status_code, 404)

    def test_unload_releases_the_model(self):
        calls = []
        app = _app(unload=lambda: calls.append("unload"))

        with patch.object(_common, "release_memory") as release:
            for method in ("get", "post"):
                response = getattr(app.test_client(), method)("/unload-model")
                self.assertEqual(response.status_code, 200)

        self.assertEqual(calls, ["unload", "unload"])
        self.assertEqual(release.call_count, 2)


class RequestParsingTest(SimpleTestCase):
    def test_fields_and_defaults(self):
        response = _app().test_client().post("/work", json={"value": 3})

        self.assertEqual(response.get_json(), {"value": 3, "flag": "default"})

    def test_a_missing_field_is_an_empty_400(self):
        response = _app().test_client().post("/work", json={"flag": 1})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.data, b"")

    def test_a_body_that_is_not_a_json_object_is_an_empty_400(self):
        client = _app().test_client()
        for kwargs in ({"json": [1, 2]}, {"data": "value=1"}, {}):
            with self.subTest(kwargs=kwargs):
                response = client.post("/work", **kwargs)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.data, b"")


class ErrorTest(SimpleTestCase):
    def test_an_unexpected_error_is_a_json_500_with_the_reason(self):
        response = _app().test_client().post("/boom")

        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            response.get_json(), {"error": "RuntimeError: model file missing"}
        )

    def test_http_errors_keep_their_status(self):
        client = _app().test_client()
        self.assertEqual(client.get("/nowhere").status_code, 404)
        self.assertEqual(client.get("/work").status_code, 405)


class ServeTest(SimpleTestCase):
    def test_binds_loopback_on_the_port_from_services(self):
        with (
            patch.dict(os.environ),
            patch("gevent.pywsgi.WSGIServer") as server,
        ):
            os.environ.pop("SERVICE_HOST", None)
            _common.serve_forever(_app(), "ocr")

        self.assertEqual(server.call_args.args[0], ("127.0.0.1", SERVICES["ocr"]))
        server.return_value.serve_forever.assert_called_once_with()

    def test_service_host_overrides_the_bind_address(self):
        with (
            patch.dict(os.environ, {"SERVICE_HOST": "0.0.0.0"}),
            patch("gevent.pywsgi.WSGIServer") as server,
        ):
            _common.serve_forever(_app(), "exif")

        self.assertEqual(server.call_args.args[0], ("0.0.0.0", SERVICES["exif"]))


class StandaloneBuildTest(SimpleTestCase):
    """The standalone binary compiles the shared module in by name."""

    def test_nuitka_is_told_to_include_it(self):
        import importlib.util
        from pathlib import Path

        path = Path(__file__).resolve().parents[3] / "scripts" / "build_standalone.py"
        spec = importlib.util.spec_from_file_location("build_standalone_probe", path)
        build = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(build)

        command = build.nuitka_command(Path("out"), None, "0.0.0")

        self.assertIn("--include-module=service._common", command)
