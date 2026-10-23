"""Signal receivers: one convention, one list, connected outside the tests.

Every module that runs code when a row is saved or deleted exposes
``register()``, listed in ``api.apps.SIGNAL_MODULES``, which connects each of
its receivers with a ``"<module>.<name>"`` ``dispatch_uid``. No ``@receiver``
decorators: a decorated receiver is live from whenever its module happens to
be imported, and nothing lists it.

Django's ``Signal.connect`` holds a receiver through a weak reference unless
it is told otherwise. Under ``DEBUG`` it also checks the receiver's signature
through an lru-cached helper, and that cache keeps every inspected function
alive. The suite runs with ``DEBUG = True``, so a receiver nothing else
references (a closure built by a factory) kept working in tests and was
garbage collected straight after ``connect()`` in production.
"""

import ast
import gc
import weakref
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from importlib import import_module
from pathlib import Path

from django.db.models.signals import (
    ModelSignal,
    m2m_changed,
    post_delete,
    post_save,
    pre_delete,
    pre_save,
)
from django.test import SimpleTestCase, TestCase, override_settings

from api import sync_signals
from api.apps import SIGNAL_MODULES
from api.models.deletion_log import DeletionLog
from api.models.tag import Tag
from api.tests.utils import create_test_photo, create_test_tag, create_test_user

BACKEND = Path(__file__).resolve().parents[3]
SCANNED_PACKAGES = ("api", "nextcloud")
MODEL_SIGNALS: tuple[ModelSignal, ...] = (
    pre_save,
    post_save,
    pre_delete,
    post_delete,
    m2m_changed,
)
SIGNAL_NAMES = frozenset(
    {
        "pre_init",
        "post_init",
        "pre_save",
        "post_save",
        "pre_delete",
        "post_delete",
        "m2m_changed",
    }
)
SYNC_SIGNALS: tuple[ModelSignal, ...] = (m2m_changed, pre_delete, post_delete)


def resolve(ref: object) -> Callable[..., object] | None:
    """The receiver a ``Signal.receivers`` entry holds, or None once collected."""
    target = ref() if isinstance(ref, weakref.ReferenceType) else ref
    return target if callable(target) else None


def scanned_files() -> Iterator[Path]:
    for package in SCANNED_PACKAGES:
        for path in sorted((BACKEND / package).rglob("*.py")):
            relative = path.relative_to(BACKEND)
            if "tests" in relative.parts or relative.name == "tests.py":
                continue
            yield path


def _name_of(node: ast.expr) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def receiver_decorators(source: str) -> list[int]:
    """Lines of the ``@receiver`` / ``@receiver(...)`` decorators in ``source``."""
    lines = []
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for decorator in node.decorator_list:
                target = (
                    decorator.func if isinstance(decorator, ast.Call) else decorator
                )
                if _name_of(target) == "receiver":
                    lines.append(decorator.lineno)
    return lines


def connects_without_dispatch_uid(source: str) -> list[int]:
    """Lines of ``<model signal>.connect(...)`` calls with no ``dispatch_uid``."""
    lines = []
    for node in ast.walk(ast.parse(source)):
        if (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "connect"
            and _name_of(node.func.value) in SIGNAL_NAMES
            and not any(kw.arg == "dispatch_uid" for kw in node.keywords)
        ):
            lines.append(node.lineno)
    return lines


def connected_receivers() -> Iterator[tuple[object, object, Callable[..., object]]]:
    """(dispatch key, stored reference, receiver) of our live model receivers."""
    for signal in MODEL_SIGNALS:
        # An entry is ((key, sender), reference, ...): Django 6.1 added the
        # sender's weak reference before the is_async flag.
        for (key, _sender), ref, *_ in list(signal.receivers):
            receiver = resolve(ref)
            if receiver is None:
                continue
            module = getattr(receiver, "__module__", None) or ""
            if module.split(".")[0] in SCANNED_PACKAGES and not module.startswith(
                "api.tests"
            ):
                yield key, ref, receiver


def receiver_problems() -> list[str]:
    problems = []
    for key, ref, receiver in connected_receivers():
        module = receiver.__module__
        name = f"{module}.{receiver.__qualname__}"
        if not (isinstance(key, str) and key.startswith(f"{module}.")):
            problems.append(f"{name}: dispatch_uid {key!r} is not '{module}.<name>'")
        if module not in SIGNAL_MODULES:
            problems.append(f"{name}: {module} is not in api.apps.SIGNAL_MODULES")
        held_by_module = getattr(import_module(module), receiver.__qualname__, None)
        if isinstance(ref, weakref.ReferenceType) and held_by_module is not receiver:
            problems.append(
                f"{name}: held weakly and by nothing else; connect it with weak=False"
            )
    return problems


class SignalReceiverConventionTest(SimpleTestCase):
    def test_no_receiver_decorators(self) -> None:
        found = [
            f"{path.relative_to(BACKEND)}:{line}"
            for path in scanned_files()
            for line in receiver_decorators(path.read_text(encoding="utf-8"))
        ]
        self.assertEqual(found, [], "Connect receivers from register() instead")

    def test_every_connect_names_a_dispatch_uid(self) -> None:
        found = [
            f"{path.relative_to(BACKEND)}:{line}"
            for path in scanned_files()
            for line in connects_without_dispatch_uid(path.read_text(encoding="utf-8"))
        ]
        self.assertEqual(found, [])

    def test_connected_receivers_follow_the_convention(self) -> None:
        self.assertEqual(receiver_problems(), [])

    def test_every_listed_module_connects_a_receiver(self) -> None:
        connected = {receiver.__module__ for _, _, receiver in connected_receivers()}
        self.assertEqual(set(SIGNAL_MODULES) - connected, set())

    def test_a_planted_receiver_decorator_is_found(self) -> None:
        source = (BACKEND / "api/models/photo.py").read_text(encoding="utf-8")
        planted = (
            source
            + "\n\n@receiver(post_save, sender=Photo)\n"
            + "def planted(sender, instance, **kwargs):\n    pass\n"
        )
        self.assertEqual(receiver_decorators(source), [])
        self.assertEqual(len(receiver_decorators(planted)), 1)
        self.assertEqual(
            len(receiver_decorators("@dispatch.receiver\ndef f(**kw):\n    pass\n")),
            1,
        )

    def test_a_planted_connect_without_dispatch_uid_is_found(self) -> None:
        self.assertEqual(
            connects_without_dispatch_uid("post_delete.connect(f, sender=Tag)"), [1]
        )
        self.assertEqual(
            connects_without_dispatch_uid(
                "models.signals.post_delete.connect(f, sender=Tag)"
            ),
            [1],
        )
        self.assertEqual(
            connects_without_dispatch_uid(
                'post_delete.connect(f, sender=Tag, dispatch_uid="api.x.f")'
            ),
            [],
        )
        # allauth's SocialLogin.connect is not a signal.
        self.assertEqual(
            connects_without_dispatch_uid("sociallogin.connect(request, user)"), []
        )

    def test_a_planted_runtime_connect_is_reported(self) -> None:
        def planted(**kwargs: object) -> None:
            pass

        planted.__module__ = "api.models.photo"
        post_delete.connect(planted, sender=Tag, weak=False)
        try:
            problems = receiver_problems()
        finally:
            post_delete.disconnect(planted, sender=Tag)

        name = "api.models.photo." + planted.__qualname__
        self.assertIn(
            f"{name}: dispatch_uid {id(planted)!r} is not 'api.models.photo.<name>'",
            problems,
        )
        self.assertIn(
            f"{name}: api.models.photo is not in api.apps.SIGNAL_MODULES", problems
        )
        self.assertEqual(receiver_problems(), [])

    def test_a_weakly_held_closure_is_reported(self) -> None:
        def closure(**kwargs: object) -> None:
            pass

        closure.__module__ = "api.sync_signals"
        post_delete.connect(
            closure, sender=Tag, dispatch_uid="api.sync_signals.planted_closure"
        )
        try:
            problems = receiver_problems()
        finally:
            post_delete.disconnect(
                sender=Tag, dispatch_uid="api.sync_signals.planted_closure"
            )

        self.assertIn(
            f"api.sync_signals.{closure.__qualname__}: held weakly and by nothing "
            "else; connect it with weak=False",
            problems,
        )


@contextmanager
def sync_receivers_registered_without_debug() -> Iterator[None]:
    """Connect ``api.sync_signals`` afresh, as a production boot does."""
    saved = {signal: list(signal.receivers) for signal in SYNC_SIGNALS}
    try:
        for signal in SYNC_SIGNALS:
            with signal.lock:
                signal.receivers = [
                    entry
                    for entry in signal.receivers
                    if getattr(resolve(entry[1]), "__module__", None)
                    != "api.sync_signals"
                ]
                signal.sender_receivers_cache.clear()
        with override_settings(DEBUG=False):
            sync_signals.register()
        gc.collect()
        yield
    finally:
        for signal, receivers in saved.items():
            with signal.lock:
                signal.receivers = receivers
                signal.sender_receivers_cache.clear()


class SyncReceiversWithoutDebugTest(TestCase):
    def test_tag_delete_writes_a_tombstone(self) -> None:
        user = create_test_user()
        tag = create_test_tag(name="beach", owner=user)
        tag_id = tag.pk

        with sync_receivers_registered_without_debug():
            tag.delete()

        self.assertTrue(
            DeletionLog.objects.filter(
                entity=DeletionLog.ENTITY_TAG, entity_id=str(tag_id), owner=user
            ).exists()
        )

    def test_photo_membership_bumps_the_tag(self) -> None:
        user = create_test_user()
        tag = create_test_tag(name="beach", owner=user)
        before = Tag.objects.get(pk=tag.pk).last_modified
        photo = create_test_photo(owner=user)

        with sync_receivers_registered_without_debug():
            # The tag's own count receiver saves photo_count only, which
            # leaves last_modified alone; the bump comes from sync_signals.
            tag.photos.add(photo)

        self.assertGreater(Tag.objects.get(pk=tag.pk).last_modified, before)
