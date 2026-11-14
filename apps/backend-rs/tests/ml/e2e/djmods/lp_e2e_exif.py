"""Serve Django's exif sidecar calls in-process (port 8010 is taken by
another session's sidecar); every ML sidecar stays the real one."""

from django.apps import AppConfig


class LpE2eExifConfig(AppConfig):
    name = "lp_e2e_exif"
    label = "lp_e2e_exif"

    def ready(self):
        from api.management.commands.seed_fixture import _route_exif_in_process

        _route_exif_in_process()
