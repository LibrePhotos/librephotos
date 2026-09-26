"""The workers reach the sidecars on 127.0.0.1, never through ``localhost``.

The sidecars listen on IPv4 only. ``localhost`` resolves to ``::1`` first and
Windows retries the refused connection for about two seconds before trying
127.0.0.1, so a scan on a native Windows install spent two seconds per sidecar
request doing nothing.
"""

import os
import re

from django.test import SimpleTestCase

from api.services import SERVICES
from api.sidecars import sidecar_url

BACKEND = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
SOURCE_DIRS = ("api", "librephotos", "service", "image_similarity")
PORTS = "|".join(str(port) for port in SERVICES.values())
LOCALHOST_SIDECAR = re.compile(rf"localhost:(?:{PORTS})\b|localhost:\{{port\}}")


class SidecarUrlTest(SimpleTestCase):
    def test_sidecar_url_is_ipv4_loopback(self):
        self.assertEqual(
            sidecar_url(8010, "/get-tags"), "http://127.0.0.1:8010/get-tags"
        )

    def test_no_sidecar_is_called_through_localhost(self):
        offenders = []
        for top in SOURCE_DIRS:
            for root, dirs, files in os.walk(os.path.join(BACKEND, top)):
                dirs[:] = [d for d in dirs if d not in ("tests", "__pycache__")]
                for name in files:
                    if not name.endswith(".py"):
                        continue
                    path = os.path.join(root, name)
                    with open(path, encoding="utf-8") as handle:
                        for number, line in enumerate(handle, 1):
                            if LOCALHOST_SIDECAR.search(line):
                                offenders.append(
                                    f"{os.path.relpath(path, BACKEND)}:{number}"
                                )
        self.assertEqual(offenders, [], "use api.sidecars.sidecar_url")
