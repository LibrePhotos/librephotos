"""Modules that load on first use.

The API server imports most of ``api`` through its views, while libvips,
LibRaw and Pillow's HEIC/JXL plugins are only used by the scan and the
workers. Holding them behind a :class:`LazyModule` keeps them out of every
server process (memory, start-up time) without changing the call sites, and
the name stays a module attribute that tests can patch.
"""

import importlib


class LazyModule:
    """Stands in for module *name*; imports it on the first attribute access."""

    def __init__(self, name):
        self.__dict__["_lazy_name"] = name

    def __getattr__(self, attr):
        return getattr(importlib.import_module(self._lazy_name), attr)

    def __repr__(self):
        return f"<lazy module {self._lazy_name!r}>"
