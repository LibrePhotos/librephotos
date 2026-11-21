from collections.abc import Mapping, Sequence
from typing import NamedTuple
from unittest import mock

from api.jobs import payload, store
from api.models import QueuedTask

_add = store.add


class QueueRecorder(mock.MagicMock):
    def __call__(
        self,
        func: store.TaskFunc | str,
        args: Sequence[object] = (),
        kwargs: Mapping[str, object] | None = None,
        placement: store.Placement | None = None,
    ) -> QueuedTask | None:
        super().__call__(func, *args, **(kwargs or {}))
        return _add(func, args, kwargs, placement)

    def _get_child_mock(self, **kw: object) -> mock.MagicMock:
        return mock.MagicMock(**kw)


def recording_queue() -> mock._patch[QueueRecorder]:
    return mock.patch("api.jobs.store.add", new_callable=QueueRecorder)


class QueuedCall(NamedTuple):
    func: str
    args: list[object]
    kwargs: dict[str, object]
    status: str


def queued_calls() -> list[QueuedCall]:
    return [
        QueuedCall(
            task.func,
            payload.decode_args(task.args),
            payload.decode_kwargs(task.kwargs),
            task.status,
        )
        for task in QueuedTask.objects.order_by("id")
    ]


def run_queued(limit: int = 10000) -> int:
    from api.jobs.worker import run_task
    from api.models.task_queue import QUEUES

    ran = 0
    while ran < limit:
        task = store.claim("test-runner", QUEUES)
        if task is None:
            return ran
        run_task(task)
        ran += 1
    return ran
