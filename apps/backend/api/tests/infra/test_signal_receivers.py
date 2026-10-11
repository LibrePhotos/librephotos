"""The model signal receivers stay connected outside the test settings.

Django's ``Signal.connect`` holds a receiver through a weak reference unless
it is told otherwise. Under ``DEBUG`` it also checks the receiver's signature
through an lru-cached helper, and that cache keeps every inspected function
alive. The suite runs with ``DEBUG = True``, so a receiver nothing else
references (a closure built by a factory) kept working in tests and was
garbage collected straight after ``connect()`` in production.
"""

import gc
import weakref
from collections.abc import Callable, Iterator
from contextlib import contextmanager

from django.db.models.signals import ModelSignal, m2m_changed, post_delete, pre_delete
from django.test import TestCase, override_settings

from api import sync_signals
from api.models.deletion_log import DeletionLog
from api.models.tag import Tag
from api.tests.utils import create_test_photo, create_test_user

SYNC_SIGNALS: tuple[ModelSignal, ...] = (m2m_changed, pre_delete, post_delete)


def resolve(ref: object) -> Callable[..., object] | None:
    """The receiver a ``Signal.receivers`` entry holds, or None once collected."""
    target = ref() if isinstance(ref, weakref.ReferenceType) else ref
    return target if callable(target) else None


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
        tag = Tag.objects.create(name="beach", owner=user)
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
        tag = Tag.objects.create(name="beach", owner=user)
        before = Tag.objects.get(pk=tag.pk).last_modified
        photo = create_test_photo(owner=user)

        with sync_receivers_registered_without_debug():
            # The tag's own count receiver saves photo_count only, which
            # leaves last_modified alone; the bump comes from sync_signals.
            tag.photos.add(photo)

        self.assertGreater(Tag.objects.get(pk=tag.pk).last_modified, before)
