"""The one way a backend test stubs a module name or loads a file outside the app.

Some code cannot be imported as a package. The sidecars under ``service/`` and
``image_similarity/`` run as scripts and import their siblings by bare name
(``utils``, ``retrieval_index``, ``lfm2_vl``), so a test that loads them has to
put a stand-in under that name first.

``stub_modules`` puts the stand-ins in ``sys.modules`` for the duration of a
block and restores exactly the names it touched on exit. It does not use
``patch.dict(sys.modules)``: that clears the whole dict on exit, which drops
every module first imported inside the block and re-imports it under a new
identity for the rest of the process.

``api/tests/infra/test_test_suite_layout.py`` fails on a direct ``sys.modules``
write anywhere else in the test tree.
"""

import contextlib
import importlib.util
import logging
import sys
import types
import uuid
from collections.abc import Iterator, Mapping
from pathlib import Path

# api/tests/stubs.py -> api/tests -> api -> the backend root.
BACKEND_ROOT = Path(__file__).resolve().parents[2]


@contextlib.contextmanager
def stub_modules(modules: Mapping[str, types.ModuleType]) -> Iterator[None]:
    """Install *modules* under their names in ``sys.modules`` until the block ends.

    Each name is put back as it was (or removed if it was absent), including
    when the block raises.
    """
    saved: dict[str, types.ModuleType | None] = {
        name: sys.modules.get(name) for name in modules
    }
    sys.modules.update(modules)
    try:
        yield
    finally:
        for name, previous in saved.items():
            if previous is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous


def sidecar_utils_stub(logger_name: str) -> types.ModuleType:
    """A stand-in for a sidecar's ``utils`` module, which only provides ``logger``.

    The real ``utils`` reconfigures the process's logging when it is imported
    (``configure_standalone``), which would break the log-rotation tests.
    """
    stub = types.ModuleType("utils")
    stub.logger = logging.getLogger(logger_name)
    return stub


def load_backend_file(
    relative_path: str,
    *,
    name: str,
    stubs: Mapping[str, types.ModuleType] | None = None,
) -> types.ModuleType:
    """Execute ``relative_path`` (under the backend root) as a fresh module called *name*.

    *stubs* are in ``sys.modules`` while the file runs. The module is registered
    under *name* only during execution (``dataclasses`` looks it up then) and is
    not left behind, so loading the same file again gives a new module object.
    """
    path = BACKEND_ROOT / relative_path
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    with stub_modules({**(stubs or {}), name: module}):
        spec.loader.exec_module(module)
    return module


def unique_module_name(prefix: str) -> str:
    """A module name no other load in the process uses."""
    return f"{prefix}_{uuid.uuid4().hex}"
