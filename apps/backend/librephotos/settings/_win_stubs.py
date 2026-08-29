"""Lightweight import stubs for native / heavy-ML dependencies.

On a Windows dev box several backend dependencies cannot be pip-installed without
a full native build toolchain or large binary runtimes (libvips, libmagic,
ImageMagick, torch, faiss, hdbscan, insightface, llama-cpp-python, onnxruntime,
the owncloud client, the exiftool binary, ...).

None of those are needed to exercise the pure-Python API / model / view logic that
the test suite covers. This module installs a meta-path finder that fabricates a
harmless stub module for any import whose top-level package is in ``STUB_ROOTS``.
Each stub returns ``MagicMock`` objects for attribute access, so importing the app
and running tests succeeds; any test that genuinely needs real behaviour from one
of these libraries will fail loudly (a MagicMock where a string/array was expected)
rather than silently — which is the correct signal that the test needs the real
dependency and should run in the Linux container instead.

Only used by ``librephotos.settings.test_windows``. CI on Linux installs the full
``requirements.txt`` and never imports this.
"""

import sys
import types
from importlib.abc import Loader, MetaPathFinder
from importlib.machinery import ModuleSpec
from unittest.mock import MagicMock

# Top-level packages we replace with stubs. Anything under them (e.g.
# ``sklearn.decomposition``, ``torch.nn``) is fabricated on demand by the finder.
STUB_ROOTS = {
    "torch",
    "transformers",
    "sentence_transformers",
    "faiss",
    "hdbscan",
    "sklearn",
    "insightface",
    "llama_cpp",
    "onnxruntime",
    "sentencepiece",
    "timm",
    "magic",
    "pyvips",
    "owncloud",
    "wand",
    "cv2",
    "exiftool",
    "timezonefinder",
    "nmslib",
    "annoy",
}


class _StubModule(types.ModuleType):
    def __getattr__(self, name):
        # Dunder lookups should behave like a normal module (raise) so the import
        # machinery and tools don't get confused by fake __path__/__all__ etc.
        if name.startswith("__") and name.endswith("__"):
            raise AttributeError(name)
        mock = MagicMock(name=f"{self.__name__}.{name}")
        setattr(self, name, mock)
        return mock


class _StubLoader(Loader):
    def create_module(self, spec):
        module = _StubModule(spec.name)
        module.__path__ = []  # treat as a package so submodule imports resolve
        module.__spec__ = spec
        return module

    def exec_module(self, module):  # noqa: D401 - nothing to execute
        pass


class _StubFinder(MetaPathFinder):
    def find_spec(self, fullname, path, target=None):
        root = fullname.split(".")[0]
        if root in STUB_ROOTS:
            return ModuleSpec(fullname, _StubLoader(), is_package=True)
        return None


def install():
    """Insert the stub finder once, ahead of the real import machinery."""
    if not any(isinstance(f, _StubFinder) for f in sys.meta_path):
        sys.meta_path.insert(0, _StubFinder())
