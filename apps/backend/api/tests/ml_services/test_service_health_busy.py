"""A sidecar that cannot answer its health probe is only restarted when its
process is gone; one busy with inference is left alone."""

from unittest.mock import patch

import requests
from django.test import SimpleTestCase

from api import services


@patch("api.services.requests.get", side_effect=requests.ConnectionError("reset"))
class BusySidecarTest(SimpleTestCase):
    def test_a_running_sidecar_that_does_not_answer_is_healthy(self, _get):
        with patch("api.services._service_process_running", return_value=True):
            self.assertTrue(services.is_healthy("tags"))

    def test_a_vanished_sidecar_is_not(self, _get):
        with patch("api.services._service_process_running", return_value=False):
            self.assertFalse(services.is_healthy("tags"))

    def test_a_timeout_counts_the_same_way(self, get):
        get.side_effect = requests.Timeout("slow")
        with patch("api.services._service_process_running", return_value=True):
            self.assertTrue(services.is_healthy("clip_embeddings"))


class ProcessLookupTest(SimpleTestCase):
    def test_finds_the_sidecar_by_its_command_line(self):
        class Proc:
            def __init__(self, cmdline):
                self.info = {"pid": 1, "cmdline": cmdline}

        with patch(
            "psutil.process_iter",
            return_value=[
                Proc(["python", "manage.py"]),
                Proc(["python", "service/tags/main.py"]),
            ],
        ):
            self.assertTrue(services._service_process_running("tags"))
            self.assertFalse(services._service_process_running("exif"))
