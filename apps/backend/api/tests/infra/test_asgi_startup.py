"""The ASGI entry point sets Django up where the database can be used.

uvicorn imports ``librephotos.asgi`` from inside its running event loop
(``Server._serve`` calls ``Config.load``). Importing it runs ``django.setup()``
and with it every ``AppConfig.ready()``, and Django refuses synchronous database
access from a thread with a running loop. ``ApiConfig.ready()`` reads the log
rotation settings from constance, so every web worker logged
``SynchronousOnlyOperation`` and ignored the admin's settings.

Django is already set up in the test process, so the import is probed in a
fresh interpreter, the way uvicorn does it.
"""

import json
import os
import subprocess
import sys
import unittest

from api.tests.stubs import BACKEND_ROOT

_PROBE = """
import asyncio
import json

from django.db import connection

import api.apps

ready = api.apps.ApiConfig.ready
seen = {}


def probing_ready(self):
    # The same check Django makes before any query: is a loop running here?
    try:
        connection.ensure_connection()
        seen["error"] = None
    except Exception as exc:
        seen["error"] = f"{type(exc).__name__}: {exc}"
    ready(self)


api.apps.ApiConfig.ready = probing_ready


async def load():
    import librephotos.asgi  # noqa: F401


asyncio.run(load())
print("PROBE_JSON:" + json.dumps(seen))
"""


class AsgiStartupTests(unittest.TestCase):
    def test_app_ready_can_query_the_database_when_loaded_inside_a_loop(self) -> None:
        env = {
            **os.environ,
            "DJANGO_SETTINGS_MODULE": "librephotos.settings.test_sqlite",
        }
        result = subprocess.run(
            [sys.executable, "-c", _PROBE],
            cwd=str(BACKEND_ROOT),
            env=env,
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
        )
        payload = None
        for line in result.stdout.splitlines():
            if line.startswith("PROBE_JSON:"):
                payload = json.loads(line[len("PROBE_JSON:") :])
        if payload is None or "error" not in payload:
            self.fail(
                "the probe did not get as far as ApiConfig.ready()\n"
                f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
            )
        self.assertIsNone(
            payload["error"],
            "ApiConfig.ready() ran on uvicorn's event loop thread, where Django "
            "refuses database access",
        )
