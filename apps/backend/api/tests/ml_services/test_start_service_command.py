"""``manage.py start_service <name>`` has to accept a single service name.

``choices=[SERVICES.keys(), "all"]`` put the dict_keys view itself in the list,
so argparse accepted only ``all`` and rejected every real service name.
"""

from unittest.mock import patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase

from api.services import SERVICES


@patch("api.management.commands.start_service.start_service")
class StartServiceCommandChoicesTest(SimpleTestCase):
    def test_every_service_name_is_accepted(self, start_service):
        for name in SERVICES:
            with self.subTest(service=name):
                start_service.reset_mock()
                call_command("start_service", name)
                start_service.assert_called_once_with(name)

    def test_unknown_service_is_rejected(self, start_service):
        with self.assertRaises(CommandError):
            call_command("start_service", "no_such_service")
        start_service.assert_not_called()
