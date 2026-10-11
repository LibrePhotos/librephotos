"""Modules that load on first use.

The API server imports most of ``api`` through its views, while libvips,
LibRaw and Pillow's HEIC/JXL plugins are only used by the scan and the
workers. Holding them behind a :class:`LazyModule` keeps them out of every
server process (memory, start-up time) without changing the call sites, and
the name stays a module attribute that tests can patch.

The type checker sees the real module instead::

    if TYPE_CHECKING:
        import numpy as np
    else:
        np = LazyModule("numpy")
"""

import importlib


class LazyModule:
    """Stands in for module *name*; imports it on the first attribute access."""

    _lazy_name: str

    def __init__(self, name: str) -> None:
        self.__dict__["_lazy_name"] = name

    def __getattr__(self, attr: str) -> object:
        return getattr(importlib.import_module(self._lazy_name), attr)

    def __repr__(self) -> str:
        return f"<lazy module {self._lazy_name!r}>"
