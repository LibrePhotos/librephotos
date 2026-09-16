"""The Windows wheel URLs in requirements.txt must carry the same version as the PyPI pin."""

import os
import re
import unittest

REQUIREMENTS = os.path.join(
    os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    ),
    "requirements.txt",
)
PIN_RE = re.compile(r"^([A-Za-z0-9][A-Za-z0-9._-]*)(\[[^\]]*\])?==([^\s;]+)")
WHEEL_RE = re.compile(
    r"^([A-Za-z0-9][A-Za-z0-9._-]*) @ \S*/[A-Za-z0-9_.]+-([0-9][A-Za-z0-9_.!+]*)-[^/]*\.whl"
)


def _norm(name):
    return name.lower().replace("_", "-")


class WindowsWheelPinsTests(unittest.TestCase):
    def test_wheel_urls_match_pypi_pins(self):
        pins, wheels = {}, {}
        with open(REQUIREMENTS, encoding="utf-8") as handle:
            for line in handle:
                line = line.strip()
                if pin := PIN_RE.match(line):
                    pins.setdefault(_norm(pin.group(1)), set()).add(pin.group(3))
                elif wheel := WHEEL_RE.match(line):
                    wheels[_norm(wheel.group(1))] = wheel.group(2)
        self.assertTrue(wheels, "expected at least one Windows wheel line")
        for name, version in wheels.items():
            self.assertIn(
                version,
                pins.get(name, set()),
                f"{name} wheel {version} vs pins {pins.get(name)}",
            )
