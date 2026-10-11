"""Modules that load on first use.

The API server imports most of ``api`` through its views, while libvips,
LibRaw and Pillow's HEIC/JXL plugins are only used by the scan and the
workers. Holding them behind a :class:`LazyModule` keeps them out of every
server process (memory, start-up time) without changing the call sites, and
the name stays a module attribute that tests can patch.
"""

import importlib
from typing import Any


class LazyModule:
    """Stands in for module *name*; imports it on the first attribute access."""

    def __init__(self, name: str) -> None:
        self.__dict__["_lazy_name"] = name

    # The attributes are whatever the lazily imported module defines, and there
    # is no static type for them short of importing it, which is what this
    # class exists to avoid. ``object`` would make every ``np.mean(...)`` at the
    # call sites an error.
    def __getattr__(self, attr: str) -> Any:  # noqa: ANN401
        return getattr(importlib.import_module(self._lazy_name), attr)

    def __repr__(self) -> str:
        return f"<lazy module {self._lazy_name!r}>"
