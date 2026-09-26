"""The sidecars listen on loopback unless SERVICE_HOST says otherwise.

They have no authentication, and the backend only ever calls them on
127.0.0.1 (api.sidecars), so listening on every interface exposed them - the
thumbnail sidecar writes files, the others read any path they are given - to
whatever can reach the container. SERVICE_HOST still overrides the default.

The mains are scripts that import their neighbours by bare name, so this reads
the source instead of importing eight of them into one process.
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


def _bind_hosts(path):
    """The (env var, default) of every os.environ.get(...) a WSGIServer binds."""
    hosts = []
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if not (isinstance(node, ast.Call) and getattr(node.func, "id", None)):
            continue
        if node.func.id != "WSGIServer":
            continue
        host = node.args[0].elts[0]
        hosts.append(tuple(arg.value for arg in host.args))
    return hosts


class SidecarBindHostTest(SimpleTestCase):
    def test_every_sidecar_defaults_to_loopback(self):
        for service in SERVICES:
            with self.subTest(service=service):
                self.assertEqual(
                    _bind_hosts(_service_main(service)),
                    [("SERVICE_HOST", "127.0.0.1")],
                )
