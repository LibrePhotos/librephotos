"""What the watchdog finds a sidecar doing decides what it does about it.

It used to count a running process that missed its health probe as busy, so
a hung sidecar was never restarted; it skipped a sidecar whose feature was
turned off, so one that ran on was never stopped; and a start that timed out
was reported as a success.
"""

import datetime
from unittest.mock import MagicMock, patch

import requests
from django.db import OperationalError
from django.test import SimpleTestCase, TestCase
from django.utils import timezone

from api.models import SidecarWatchLease
from api.runtime import supervisor
from api.runtime.http_timeouts import HEALTH_CHECK, PATIENT_HEALTH_CHECK
from api.runtime.supervisor import SidecarStatus, WatchdogAction


def _answer(service):
    response = MagicMock(status_code=200)
    response.json.return_value = {
        "status": "OK",
        "service": service,
        "last_request_time": None,
        "model_loaded": None,
    }
    return response


class _Watchdog(TestCase):
    """check_services over one enabled sidecar, ``tags``, with fake probes."""

    service = "tags"

    def setUp(self):
        self.answers = {}
        self.enabled = True
        self.process_running = True
        self.stop = self.enterContext(patch("api.runtime.supervisor.stop_service"))
        self.start = self.enterContext(patch("api.runtime.supervisor.start_service"))
        self.enterContext(
            patch(
                "api.runtime.supervisor.is_service_enabled",
                side_effect=lambda s: s == self.service and self.enabled,
            )
        )
        self.enterContext(
            patch(
                "api.runtime.supervisor._service_process_running",
                side_effect=lambda s: s == self.service and self.process_running,
            )
        )
        self.get = self.enterContext(
            patch("api.runtime.supervisor.requests.get", side_effect=self._get)
        )

    def _get(self, url, timeout):
        answer = self.answers.get(timeout)
        if answer is None:
            raise requests.Timeout("no answer")
        return answer

    def timeouts_asked(self):
        return [call.kwargs["timeout"] for call in self.get.call_args_list]


class WatchdogTest(_Watchdog):
    def test_a_sidecar_that_answers_no_probe_is_restarted(self):
        supervisor.check_services()

        self.assertEqual(self.timeouts_asked(), [HEALTH_CHECK, PATIENT_HEALTH_CHECK])
        self.stop.assert_called_once_with(self.service)
        self.start.assert_called_once_with(self.service)

    def test_a_busy_sidecar_that_answers_the_patient_probe_is_left_alone(self):
        self.answers[PATIENT_HEALTH_CHECK] = _answer(self.service)

        supervisor.check_services()

        self.stop.assert_not_called()
        self.start.assert_not_called()

    def test_a_sidecar_whose_feature_was_turned_off_is_stopped(self):
        self.enabled = False

        supervisor.check_services()

        self.stop.assert_called_once_with(self.service)
        self.start.assert_not_called()
        self.get.assert_not_called()

    def test_a_turned_off_sidecar_that_is_gone_is_left_alone(self):
        self.enabled = False
        self.process_running = False

        supervisor.check_services()

        self.stop.assert_not_called()

    def test_a_sidecar_without_a_process_is_started_without_the_patient_probe(self):
        self.process_running = False

        supervisor.check_services()

        self.assertEqual(self.timeouts_asked(), [HEALTH_CHECK])
        self.start.assert_called_once_with(self.service)

    def test_the_services_page_still_counts_a_silent_process_as_healthy(self):
        self.assertTrue(supervisor.is_healthy(self.service))
        self.assertEqual(self.timeouts_asked(), [HEALTH_CHECK])


class OverlappingWatchdogRunsTest(_Watchdog):
    """A run waiting on the patient probe outlasts the minute: the next run
    starts in another worker before the first one is done."""

    def test_a_second_run_during_the_patient_probe_leaves_the_sidecar_alone(self):
        second_run_probes = []

        def get(url, timeout):
            if timeout == PATIENT_HEALTH_CHECK and not second_run_probes:
                second_run_probes.append(len(self.get.call_args_list))
                supervisor.check_services()
                second_run_probes.append(len(self.get.call_args_list))
            raise requests.Timeout("no answer")

        self.get.side_effect = get

        supervisor.check_services()

        before, after = second_run_probes
        self.assertEqual(before, after, "the second run probed the sidecar too")
        self.stop.assert_called_once_with(self.service)
        self.start.assert_called_once_with(self.service)

    def test_the_next_run_checks_it_again(self):
        supervisor.check_services()
        supervisor.check_services()

        self.assertEqual(self.start.call_count, 2)

    def test_a_lease_left_by_a_run_that_died_expires(self):
        self.assertTrue(SidecarWatchLease.objects.take(self.service, "died", 60))

        supervisor.check_services()
        self.start.assert_not_called()

        SidecarWatchLease.objects.filter(service=self.service).update(
            expires_at=timezone.now() - datetime.timedelta(seconds=1)
        )
        supervisor.check_services()
        self.start.assert_called_once_with(self.service)

    def test_a_database_that_is_down_does_not_stop_the_watchdog(self):
        with patch.object(
            SidecarWatchLease.objects, "take", side_effect=OperationalError("down")
        ):
            supervisor.check_services()

        self.start.assert_called_once_with(self.service)


class CheckServiceTest(_Watchdog):
    def test_each_finding(self):
        cases = {
            SidecarStatus.UP: ({HEALTH_CHECK: _answer("tags")}, True, True),
            SidecarStatus.FOREIGN: ({HEALTH_CHECK: _answer("exif")}, True, True),
            SidecarStatus.BUSY: ({PATIENT_HEALTH_CHECK: _answer("tags")}, True, True),
            SidecarStatus.HUNG: ({}, True, True),
            SidecarStatus.DOWN: ({}, True, False),
            SidecarStatus.OFF_BUT_RUNNING: ({}, False, True),
            SidecarStatus.OFF: ({}, False, False),
        }
        for status, (answers, enabled, running) in cases.items():
            with self.subTest(status):
                self.answers = answers
                self.enabled = enabled
                self.process_running = running
                self.assertIs(supervisor.check_service("tags").status, status)

    def test_every_finding_has_an_action(self):
        self.assertEqual(set(supervisor.WATCHDOG_ACTIONS), set(SidecarStatus))
        self.assertEqual(
            supervisor.WATCHDOG_ACTIONS[SidecarStatus.HUNG], WatchdogAction.RESTART
        )

    def test_the_patient_probe_waits_as_long_as_any_client(self):
        from api.runtime import http_timeouts

        self.assertEqual(PATIENT_HEALTH_CHECK[1], http_timeouts.CAPTION[1])
        self.assertGreater(PATIENT_HEALTH_CHECK[1], HEALTH_CHECK[1])


class StartTimeoutTest(SimpleTestCase):
    def setUp(self):
        supervisor._start_errors.clear()
        self.addCleanup(supervisor._start_errors.clear)
        supervisor._processes.clear()
        self.addCleanup(supervisor._processes.clear)

    def test_a_start_that_times_out_is_a_failure_and_leaves_the_process(self):
        process = MagicMock(pid=501, returncode=None)
        process.poll.return_value = None
        with (
            patch("api.runtime.supervisor.is_service_enabled", return_value=True),
            patch("api.runtime.supervisor._answers_as_itself", return_value=False),
            patch("api.runtime.supervisor.port_conflict", return_value=None),
            patch("api.runtime.supervisor.subprocess.Popen", return_value=process),
            patch("api.runtime.supervisor.START_TIMEOUT_SECONDS", 0),
            self.assertLogs("api.runtime.supervisor", "WARNING"),
        ):
            self.assertFalse(supervisor.start_service("face_recognition"))

        self.assertIn("has not answered", supervisor.start_error("face_recognition"))
        process.kill.assert_not_called()
        process.terminate.assert_not_called()
        self.assertIs(supervisor._processes["face_recognition"], process)
