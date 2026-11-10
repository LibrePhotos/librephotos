"""Our ExifTool client: ``exiftool -stay_open`` driven over its stdin.

Both the exif sidecar (reads) and ``api.metadata.writer`` (writes) use it, so
it imports nothing from Django (the ``django-free`` import contract).

``ExifToolProcess`` is one running ExifTool. Each command ends with
``-echo3 {status $status}`` and ``-echo4 {readyN}``, then ``-executeN``:
ExifTool prints the exit status and ``{readyN}`` on stdout and ``{readyN}`` on
stderr once the command is done, so both streams can be read up to the end of
exactly that command. A thread per stream reads its pipe, which lets
``run`` give up after a timeout on every platform (Windows has no ``select``
for pipes); a timed-out ExifTool is killed.

``ExifTool`` is what the sidecar reads through: it starts its process on the
first command, starts a new one when the last died or timed out, and answers
in the shapes the sidecar's code reads (``get_tag``, ``get_tags_batch``,
``execute_json``), the ones PyExifTool 0.4.9 answered before it.
"""

from __future__ import annotations

import json
import os
import queue
import re
import secrets
import sys
import threading
import time
from collections.abc import Sequence
from dataclasses import dataclass
from typing import IO, Self

from api.runtime import binaries

# How long a stopping ExifTool gets to exit before it is killed.
STOP_TIMEOUT_SECONDS = 10
# How long a read may take. The backend gives up on the exif sidecar after 30 s
# (api.runtime.http_timeouts.EXIF); a command that hangs fails before that, and
# its ExifTool is replaced on the next command.
READ_TIMEOUT_SECONDS = 25
# What ExifTool prints by default: ``-G`` groups every key (``EXIF:Make``),
# ``-n`` turns print conversion off (numbers stay numbers).
GROUPED_NUMERIC = ("-G", "-n")

_STATUS = re.compile(rb"\{status (\d+)\}\s*$")


class ExifToolError(Exception):
    """ExifTool did not answer a command: it exited, or never started.

    The message carries what ExifTool printed on stderr, if anything.
    """


class ExifToolTimeoutError(ExifToolError, TimeoutError):
    """ExifTool did not answer a command in time; it was killed."""


class UnsafeArgumentError(ExifToolError, ValueError):
    """An argument holds a line break; nothing was sent to ExifTool."""


def refuse_line_breaks(arguments: Sequence[str | bytes]) -> None:
    """Raise ``UnsafeArgumentError`` if any argument holds a line break.

    ExifTool reads one argument per line, so a line break inside one would
    start another argument (an option such as ``-if <perl>``). The callers
    check their own input too; this is the last check before the pipe.
    """
    for argument in arguments:
        if isinstance(argument, bytes):
            unsafe = b"\n" in argument or b"\r" in argument
        else:
            unsafe = "\n" in argument or "\r" in argument
        if unsafe:
            raise UnsafeArgumentError("refusing an ExifTool argument with a line break")


@dataclass(frozen=True)
class Answer:
    """What one command printed, and its exit status."""

    stdout: bytes
    stderr: bytes
    status: int

    def stderr_text(self) -> str:
        return self.stderr.decode("utf-8", errors="replace").strip()


class _Pipe:
    """One output stream of the process, read by a thread into a queue."""

    def __init__(self, stream: IO[bytes], name: str) -> None:
        self._chunks: queue.Queue[bytes] = queue.Queue()
        self.pending = b""
        self._stream = stream
        threading.Thread(target=self._pump, name=name, daemon=True).start()

    def _pump(self) -> None:
        try:
            while chunk := os.read(self._stream.fileno(), 65536):
                self._chunks.put(chunk)
        except OSError:
            pass  # closed under us: the process is gone
        self._chunks.put(b"")  # end of output

    def read_until(self, marker: bytes, deadline: float) -> bytes | None:
        """Everything before ``marker``; None at end of output.

        Raises ``queue.Empty`` when ``deadline`` passes first.
        """
        while marker not in self.pending:
            chunk = self._chunks.get(timeout=max(deadline - time.monotonic(), 0))
            if not chunk:
                return None
            self.pending += chunk
        before, _, rest = self.pending.partition(marker)
        # The line break after the marker ends this command, not the next.
        self.pending = rest.removeprefix(b"\r").removeprefix(b"\n")
        return before


class ExifToolProcess:
    """``exiftool -stay_open True -@ - -common_args <common_args>``."""

    def __init__(
        self, common_args: Sequence[str] = ("-n",), *, die_with_parent: bool = False
    ) -> None:
        """``die_with_parent``: see ``binaries.start_piped_tool``. ExifTool does not
        exit when its stdin closes, so a process that may be killed (a
        sidecar) asks for it."""
        self._process = binaries.start_piped_tool(
            "exiftool",
            ["-stay_open", "True", "-@", "-", "-common_args", *common_args],
            die_with_parent=die_with_parent,
        )
        assert self._process.stdout is not None and self._process.stderr is not None
        self._stdout = _Pipe(self._process.stdout, "exiftool-stdout")
        self._stderr = _Pipe(self._process.stderr, "exiftool-stderr")
        self._commands = 0
        self._token = b"lp-" + secrets.token_hex(16).encode()
        self._stopped = False

    @property
    def alive(self) -> bool:
        """Whether it still takes commands: not stopped, killed or crashed."""
        return not self._stopped and self._process.poll() is None

    def run(self, arguments: Sequence[bytes], timeout: float) -> Answer:
        """Run one command (one argument per item).

        Raises ``UnsafeArgumentError`` before sending anything when an
        argument holds a line break (ExifTool reads one argument per line, so
        it would start another one: ``-if <perl>`` runs code),
        ``ExifToolError`` when ExifTool has exited, with what it said on
        stderr, or its answer was out of step (it is killed then), and
        ``ExifToolTimeoutError`` when it did not finish within ``timeout``
        seconds (it is killed then).
        """
        refuse_line_breaks(arguments)
        self._commands += 1
        # The end of this command's output on each stream: a token of this
        # process that no file can guess, so a value cannot end it early.
        done = b"%s:%d" % (self._token, self._commands)
        ready = b"{ready%d}" % self._commands
        command = [
            *arguments,
            b"-echo3",
            b"{status ${status}}" + done,
            b"-echo4",
            done,
            b"-execute%d" % self._commands,
        ]
        stdin = self._process.stdin
        assert stdin is not None
        try:
            stdin.write(b"\n".join(command) + b"\n")
            stdin.flush()
        except OSError as error:
            self._stopped = True
            raise self._exited() from error
        deadline = time.monotonic() + timeout
        try:
            stdout = self._stdout.read_until(done, deadline)
            # ExifTool's own {readyN} follows the token, and nothing else.
            between = (
                self._stdout.read_until(ready, deadline) if stdout is not None else None
            )
            stderr = (
                self._stderr.read_until(done, deadline) if between is not None else None
            )
        except queue.Empty:
            self.kill()
            raise ExifToolTimeoutError(
                f"ExifTool did not answer within {timeout:g} s"
            ) from None
        if stdout is None or between is None or stderr is None:
            self._stopped = True
            raise self._exited()
        stdout = stdout.rstrip()
        status = _STATUS.search(stdout)
        if status is None or between.strip():
            # The streams are out of step: what is left in the pipes belongs
            # to no command. Start the next command on a fresh ExifTool.
            self.kill()
            raise ExifToolError("ExifTool's answer was out of step; restarting it")
        return Answer(stdout[: status.start()], stderr, int(status.group(1)))

    def _exited(self) -> ExifToolError:
        said = (self._stdout.pending + self._stderr.pending).decode(
            "utf-8", errors="replace"
        )
        said = said.strip()
        return ExifToolError(f"ExifTool exited: {said}" if said else "ExifTool exited")

    def kill(self) -> None:
        self._stopped = True
        binaries.kill(self._process)

    def close(self) -> None:
        """Stop ExifTool, killing it if it does not exit in time."""
        if self.alive:
            self._stopped = True
            stdin = self._process.stdin
            assert stdin is not None
            try:
                stdin.write(b"-stay_open\nFalse\n")
                stdin.flush()
                stdin.close()
            except OSError:
                pass  # already gone
            if binaries.wait(self._process, STOP_TIMEOUT_SECONDS) is not None:
                return
        binaries.kill(self._process)


def _fsencode(value: str | bytes) -> bytes:
    """An argument as bytes: the file system encoding with ``surrogateescape``.

    The encoding PyExifTool used, so a file name Python could only decode with
    surrogates reaches ExifTool as the bytes it was read from.
    """
    if isinstance(value, bytes):
        return value
    return value.encode(sys.getfilesystemencoding(), "surrogateescape")


def without_paths(message: str, paths: Sequence[str]) -> str:
    """*message* with each of *paths* replaced by "the file".

    ExifTool names the file in its errors, with forward slashes on Windows.
    """
    for path in paths:
        for spelling in (path, path.replace(os.sep, "/")):
            message = message.replace(spelling, "the file")
    return message


def decode_output(output: bytes) -> str:
    """ExifTool's output as text: UTF-8, else Latin-1 (some files carry Latin-1 text)."""
    try:
        return output.decode("utf-8")
    except UnicodeDecodeError:
        return output.decode("latin-1")


class ExifTool:
    """A restartable ExifTool for reads, with ``common_args`` on every command.

    The process starts on the first command (or ``start``). One that exited
    or timed out is replaced on the next command, so a hung or crashed
    ExifTool fails one request, not every one after it. Not thread-safe: the
    sidecar serves one request at a time.
    """

    def __init__(
        self,
        common_args: Sequence[str] = GROUPED_NUMERIC,
        timeout: float = READ_TIMEOUT_SECONDS,
    ) -> None:
        self.common_args = tuple(common_args)
        self.timeout = timeout
        self._process: ExifToolProcess | None = None

    @property
    def running(self) -> bool:
        return self._process is not None and self._process.alive

    def start(self) -> None:
        if self.running:
            return
        self.terminate()  # reap a dead one
        try:
            self._process = ExifToolProcess(self.common_args, die_with_parent=True)
        except binaries.ToolError as error:
            raise ExifToolError(str(error)) from error

    def terminate(self) -> None:
        if self._process is not None:
            self._process.close()
            self._process = None

    def __enter__(self) -> Self:
        self.start()
        return self

    def __exit__(self, *exc_info: object) -> None:
        self.terminate()

    def run(self, *params: str | bytes) -> Answer:
        refuse_line_breaks(params)  # before a process is started for it
        self.start()
        assert self._process is not None
        return self._process.run([_fsencode(param) for param in params], self.timeout)

    def execute(self, *params: str | bytes) -> bytes:
        """What the command printed on stdout."""
        return self.run(*params).stdout

    def execute_json(self, *params: str | bytes) -> list[dict[str, object]]:
        """The command's ``-j`` answer, one object per file.

        Raises ``ExifToolError`` with ExifTool's stderr when it printed no
        JSON (no file it could read).
        """
        answer = self.run(b"-j", *params)
        text = decode_output(answer.stdout).strip()
        if not text:
            raise ExifToolError(answer.stderr_text() or "ExifTool answered nothing")
        parsed = json.loads(text)
        if not isinstance(parsed, list) or not all(
            isinstance(item, dict) for item in parsed
        ):
            raise ExifToolError("ExifTool answered with an unexpected shape")
        return parsed

    def get_tags_batch(
        self, tags: Sequence[str], files: Sequence[str]
    ) -> list[dict[str, object]]:
        """``tags`` of every file in one command; ExifTool leaves out a file it cannot read."""
        return self.execute_json(*(f"-{tag}" for tag in tags), *files)

    def get_tags(self, tags: Sequence[str], file: str) -> dict[str, object]:
        return self.get_tags_batch(tags, [file])[0]

    def get_tag(self, tag: str, file: str) -> object:
        """The value of ``tag`` in ``file``, None if it has none: the first key ExifTool answers."""
        data = self.get_tags([tag], file)
        data.pop("SourceFile", None)
        return next(iter(data.values()), None)
