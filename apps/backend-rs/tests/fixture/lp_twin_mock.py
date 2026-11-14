"""Sidecar stand-ins for the Django reference server (LP_DJANGO_MOCK, see
lp_twin_settings): every ML sidecar call goes to tests/tasks/mock_sidecars.py,
the exif sidecar's calls are answered by its Flask app in-process (its port,
8010, is fixed and shared machine-wide). The Rust server gets the same mock
through LP_SIDECAR_<NAME>_URL, so sidecar-backed views can be twinned.
"""

import os

from django.apps import AppConfig


class LpTwinMockConfig(AppConfig):
    name = "lp_twin_mock"
    label = "lp_twin_mock"

    def ready(self):
        from api import sidecars
        from api.management.commands.seed_fixture import _route_exif_in_process

        mock = os.environ["LP_DJANGO_MOCK"].rstrip("/")
        sidecars.sidecar_url = lambda service, path="": f"{mock}{path}"
        _route_exif_in_process()
