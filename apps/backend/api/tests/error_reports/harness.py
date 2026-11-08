"""Run the real error capture inside a test, without threads or a network.

``capturing()`` starts the capture exactly as ``ApiConfig.ready()`` does, with
two changes: the background worker runs each job at once on the test's thread
(so the test database, inside its transaction, sees the rows) and reads the
private names again, and every way
out of the process (sockets, ``requests``, urllib3) is recorded and refused.
On exit the SDK's client is closed again, so no other test captures anything.
"""

from __future__ import annotations

import contextlib
import socket
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from unittest import mock

import requests
import sentry_sdk
import urllib3
from sentry_sdk.worker import Worker

from api.error_reports import background, scrub
from api.error_reports.capture import start_capture


class InlineWorker(Worker):
    """A worker that runs each job when it is submitted."""

    @property
    def is_alive(self) -> bool:
        return True

    def kill(self) -> None:
        return None

    def full(self) -> bool:
        return False

    def submit(self, callback: Callable[[], object]) -> bool:
        callback()
        return True


@dataclass
class Outbound:
    """Every attempt to reach another host while the capture ran."""

    attempts: list[str] = field(default_factory=list)

    def refuse(self, what: str) -> Callable[..., object]:
        def refused(*args: object, **kwargs: object) -> object:
            self.attempts.append(f"{what} {args!r:.200}")
            raise ConnectionRefusedError("tests make no outgoing requests")

        return refused


@contextlib.contextmanager
def no_network() -> Iterator[Outbound]:
    """Record and refuse every outgoing connection inside the block."""
    outbound = Outbound()
    with (
        mock.patch.object(socket.socket, "connect", outbound.refuse("socket")),
        mock.patch.object(
            requests.Session, "send", outbound.refuse("requests"), create=False
        ),
        mock.patch.object(
            urllib3.connectionpool.HTTPConnectionPool,
            "urlopen",
            outbound.refuse("urllib3"),
        ),
    ):
        yield outbound


@contextlib.contextmanager
def inline_background() -> Iterator[None]:
    """Run the error reports' background jobs on the calling thread.

    Also forgets the cached scrub context, so the names this test created are
    scrubbed rather than an earlier test's.
    """
    with (
        mock.patch.dict(scrub._cache, clear=True),
        mock.patch.object(background, "_worker", InlineWorker()),
    ):
        yield


@contextlib.contextmanager
def capturing() -> Iterator[None]:
    """The capture as a fresh server starts it, run inline."""
    with inline_background():
        start_capture()
        try:
            yield
        finally:
            sentry_sdk.flush()
            sentry_sdk.get_client().close()
            sentry_sdk.get_global_scope().set_client(None)
