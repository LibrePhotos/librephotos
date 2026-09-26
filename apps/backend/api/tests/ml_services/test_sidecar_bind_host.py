"""The sidecars listen on loopback unless SERVICE_HOST says otherwise.

They have no authentication, and the backend only ever calls them on
127.0.0.1 (api.sidecars), so listening on every interface exposed them - the
thumbnail sidecar writes files, the others read any path they are given - to
whatever can reach the container. SERVICE_HOST still overrides the default.

They are all served by service._common.serve_forever. The mains are scripts
that import their neighbours by bare name, so this reads their source instead
of importing eight of them into one process.
"""

import ast
from pathlib import Path

from django.test import SimpleTestCase

from api.services import SERVICES

BACKEND = Path(__file__).resolve().parents[3]


def _service_main(service):
    if service == "image_similarity":
        return BACKEND / "image_similarity" / "main.py"
    return BACKEND / "service" / service / "main.py"


def _calls(path, name):
    """The literal arguments of every call to *name* in the file."""
    calls = []
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Call) and getattr(node.func, "id", None) == name:
            calls.append(
                [
                    arg.value if isinstance(arg, ast.Constant) else arg
                    for arg in node.args
                ]
            )
    return calls


class SidecarBindHostTest(SimpleTestCase):
    def test_every_sidecar_is_served_by_the_shared_app(self):
        """service._common binds loopback and the port from SERVICES
        (test_sidecar_common); no main.py opens a server of its own."""
        for service in SERVICES:
            with self.subTest(service=service):
                path = _service_main(service)
                self.assertEqual(_calls(path, "WSGIServer"), [])
                served = _calls(path, "serve_forever")
                self.assertEqual(len(served), 1)
                self.assertEqual(served[0][1], service)

    def test_the_shared_app_defaults_to_loopback(self):
        from service import _common

        self.assertEqual(_common.DEFAULT_HOST, "127.0.0.1")
