"""``except BaseException`` only to clean up and re-raise (#2334).

``BaseException`` also covers ``KeyboardInterrupt``, ``SystemExit`` and
``GeneratorExit``. The face jobs caught it and recorded a failed job, so a
worker being stopped carried on as if a photo had been bad. A handler that
catches it must end in a bare ``raise``; anything that is handled belongs in
``except Exception`` (or narrower).
"""

import ast
import os
from collections.abc import Iterator

from django.test import SimpleTestCase

BACKEND_ROOT = os.path.dirname(
    os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)
EXCLUDED_DIRS = {"tests", "migrations", "node_modules", "__pycache__", "screenshots"}


def backend_python_files() -> Iterator[str]:
    """The backend's Python modules that are not tests or migrations, relative."""
    for dirpath, dirnames, filenames in os.walk(BACKEND_ROOT):
        dirnames[:] = [
            d for d in dirnames if d not in EXCLUDED_DIRS and not d.startswith(".")
        ]
        for name in filenames:
            if name.endswith(".py"):
                path = os.path.join(dirpath, name)
                yield os.path.relpath(path, BACKEND_ROOT).replace(os.sep, "/")


def _catches_base_exception(handler: ast.ExceptHandler) -> bool:
    caught = handler.type
    if caught is None:  # a bare ``except:``
        return True
    names = caught.elts if isinstance(caught, ast.Tuple) else [caught]
    return any(
        (isinstance(name, ast.Name) and name.id == "BaseException")
        or (isinstance(name, ast.Attribute) and name.attr == "BaseException")
        for name in names
    )


def _ends_in_bare_raise(handler: ast.ExceptHandler) -> bool:
    last = handler.body[-1]
    return isinstance(last, ast.Raise) and last.exc is None


def swallowing_handlers(source: str) -> list[int]:
    """Lines of the handlers that catch BaseException and do not re-raise it."""
    return [
        node.lineno
        for node in ast.walk(ast.parse(source))
        if isinstance(node, ast.ExceptHandler)
        and _catches_base_exception(node)
        and not _ends_in_bare_raise(node)
    ]


class BaseExceptionHandlersTest(SimpleTestCase):
    def test_no_handler_swallows_base_exception(self):
        offenders = []
        for path in backend_python_files():
            with open(os.path.join(BACKEND_ROOT, path), encoding="utf-8") as f:
                source = f.read()
            offenders += [f"{path}:{line}" for line in swallowing_handlers(source)]
        self.assertEqual(offenders, [])

    def test_the_scan_sees_the_job_modules(self):
        files = set(backend_python_files())
        self.assertIn("api/faces/classify.py", files)
        self.assertIn("api/views/zip_downloads.py", files)

    def test_a_planted_swallowing_handler_is_caught(self):
        planted = (
            "try:\n"
            "    work()\n"
            "except BaseException as err:\n"
            "    job.fail(error=err)\n"
            "try:\n"
            "    work()\n"
            "except (OSError, BaseException):\n"
            "    raise RuntimeError('wrapped')\n"
            "try:\n"
            "    work()\n"
            "except:\n"
            "    pass\n"
        )
        self.assertEqual(swallowing_handlers(planted), [3, 7, 11])

    def test_clean_up_and_re_raise_is_allowed(self):
        cleanup = (
            "try:\n"
            "    work()\n"
            "except BaseException:\n"
            "    os.remove(temporary)\n"
            "    raise\n"
            "try:\n"
            "    work()\n"
            "except Exception as err:\n"
            "    job.fail(error=err)\n"
        )
        self.assertEqual(swallowing_handlers(cleanup), [])
