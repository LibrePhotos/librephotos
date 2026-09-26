"""The per-minute watchdog (api.services.check_services) and process handling.

It used to SIGKILL any sidecar whose last request was more than two minutes
old and start a new one, to get the model's memory back: a kill in the middle
of loading a model, a similarity index thrown away (it lived only in memory)
and a restart per idle sidecar per two minutes. The Popen handle of every
sidecar it started was dropped, so each killed child stayed a zombie of the
worker that started it. Now an idle sidecar is asked to unload its model, a
stopped one is terminated before it is killed, and the handles are kept and
reaped.
"""

import time
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import psutil
import requests
from django.test import SimpleTestCase

from api import services


def _health(**body):
    response = MagicMock()
    response.status_code = 200
    response.json.return_value = {"status": "OK", **body}
    return response


class IdleSidecarTest(SimpleTestCase):
    def setUp(self):
        services._last_health.clear()
        self.addCleanup(services._last_health.clear)

    @patch("api.services.requests.get")
    def test_an_idle_sidecar_is_healthy(self, get):
        get.return_value = _health(last_request_time=time.time() - 3600)

        self.assertTrue(services.is_healthy("tags"))

    @patch("api.sidecars.http.get")
    @patch("api.services.requests.get")
    def test_an_idle_model_is_unloaded_not_the_process_killed(self, get, unload):
        get.return_value = _health(
            last_request_time=time.time() - services.IDLE_UNLOAD_SECONDS - 1,
            model_loaded=True,
        )
        unload.return_value = MagicMock(status_code=200)

        with (
            patch("api.services.stop_service") as stop,
            patch("api.services.start_service") as start,
            patch("api.services.is_service_enabled", side_effect=lambda s: s == "tags"),
        ):
            services.check_services()

        stop.assert_not_called()
        start.assert_not_called()
        unload.assert_called_once()
        self.assertEqual(unload.call_args.args[0], "http://127.0.0.1:8011/unload-model")

    @patch("api.sidecars.http.get")
    @patch("api.services.requests.get")
    def test_a_busy_or_empty_sidecar_is_left_alone(self, get, unload):
        cases = {
            "recent": {"last_request_time": time.time(), "model_loaded": True},
            "already unloaded": {
                "last_request_time": time.time() - 3600,
                "model_loaded": False,
            },
            "holds no model": {
                "last_request_time": time.time() - 3600,
                "model_loaded": None,
            },
            "never used": {"last_request_time": None, "model_loaded": False},
            "a long request still running": {
                "last_request_time": time.time() - 3600,
                "model_loaded": True,
                "busy": True,
            },
        }
        for case, body in cases.items():
            with self.subTest(case):
                get.return_value = _health(**body)
                with patch(
                    "api.services.is_service_enabled",
                    side_effect=lambda s: s == "tags",
                ):
                    services.check_services()
                unload.assert_not_called()

    @patch("api.sidecars.http.get", side_effect=requests.ConnectionError("gone"))
    @patch("api.services.requests.get")
    def test_a_failed_unload_is_only_logged(self, get, _unload):
        get.return_value = _health(last_request_time=0.0, model_loaded=True)

        with (
            patch("api.services.is_service_enabled", side_effect=lambda s: s == "ocr"),
            self.assertLogs("ownphotos", "WARNING") as logs,
        ):
            services.check_services()

        self.assertTrue(any("unload" in line for line in logs.output), logs.output)


class ProcessHandleTest(SimpleTestCase):
    def setUp(self):
        services._processes.clear()
        self.addCleanup(services._processes.clear)

    @patch("api.services.subprocess.Popen")
    def test_start_keeps_the_handle(self, popen):
        services.start_service("thumbnail")

        self.assertIs(services._processes["thumbnail"], popen.return_value)

    def test_the_watchdog_reaps_a_sidecar_that_exited(self):
        exited = MagicMock(pid=41)
        exited.poll.return_value = -9
        running = MagicMock(pid=42)
        running.poll.return_value = None
        services._processes.update({"exif": exited, "tags": running})

        with patch("api.services.is_service_enabled", return_value=False):
            services.check_services()

        exited.poll.assert_called()
        self.assertEqual(services._processes, {"tags": running})


class StopServiceTest(SimpleTestCase):
    def setUp(self):
        services._processes.clear()
        self.addCleanup(services._processes.clear)

    def _process(self, pid, cmdline):
        process = MagicMock()
        process.info = {"pid": pid, "cmdline": cmdline}
        return process

    def test_terminates_first_and_kills_only_what_outlives_the_grace(self):
        polite = self._process(41, ["python", "service/exif/main.py"])
        stubborn = self._process(43, ["librephotos.exe", "service", "exif"])
        other = self._process(42, ["python", "service/tags/main.py"])
        handle = MagicMock()
        services._processes["exif"] = handle

        with (
            patch("psutil.process_iter", return_value=[polite, stubborn, other]),
            patch(
                "psutil.wait_procs", side_effect=[([polite], [stubborn]), ([], [])]
            ) as wait,
        ):
            self.assertTrue(services.stop_service("exif"))

        polite.terminate.assert_called_once_with()
        stubborn.terminate.assert_called_once_with()
        other.terminate.assert_not_called()
        polite.kill.assert_not_called()
        stubborn.kill.assert_called_once_with()
        self.assertEqual(
            wait.call_args_list[0].kwargs["timeout"], services.STOP_GRACE_SECONDS
        )
        # Its own child is reaped, not left a zombie.
        handle.poll.assert_called()
        self.assertNotIn("exif", services._processes)

    def test_a_process_that_is_already_gone_is_fine(self):
        gone = self._process(41, ["python", "service/exif/main.py"])
        gone.terminate.side_effect = psutil.NoSuchProcess(41)

        with (
            patch("psutil.process_iter", return_value=[gone]),
            patch("psutil.wait_procs", return_value=([], [])),
        ):
            services.stop_service("exif")

    def test_never_itself(self):
        import os

        me = SimpleNamespace(
            info={"pid": os.getpid(), "cmdline": ["librephotos.exe", "service", "exif"]}
        )
        with (
            patch("psutil.process_iter", return_value=[me]),
            patch("psutil.wait_procs", return_value=([], [])),
        ):
            self.assertFalse(services.stop_service("exif"))
