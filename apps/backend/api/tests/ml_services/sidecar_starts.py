"""Start sidecars in tests that mock Popen without probing real ports.

start_services asks each sidecar's port whether something answers before and
after it starts the process (#2324). A test that only mocks Popen would then
probe 127.0.0.1:80xx for real: slow on Windows, and wrong on a machine where a
sidecar happens to run.
"""

from collections.abc import Callable
from typing import TypeVar
from unittest.mock import patch

Target = TypeVar("Target", bound=Callable[..., object] | type)


def _all_up(launched: dict[str, object]) -> dict[str, bool]:
    return dict.fromkeys(launched, True)


def fake_sidecar_starts(target: Target) -> Target:
    """Decorate a test (or test class): the ports are free and every sidecar
    that is started answers at once, as when Popen returning was enough.

    ``new=`` patches add no argument to the decorated tests.
    """
    for patcher in (
        patch("api.runtime.supervisor._answers_as_itself", new=lambda service: False),
        patch("api.runtime.supervisor.port_conflict", new=lambda service: None),
        patch("api.runtime.supervisor._wait_until_up", new=_all_up),
    ):
        target = patcher(target)
    return target
