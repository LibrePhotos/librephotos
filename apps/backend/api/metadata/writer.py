"""Writing tags into a media file or its XMP sidecar with ExifTool.

``write_metadata`` raises ``MetadataWriteError`` when ExifTool did not write
what it was asked to (#2294): a read-only library, a damaged file, a tag
ExifTool does not know or a tag the target cannot hold. ExifTool's stderr is
read together with its stdout, so its warnings and errors reach the caller.

Each ``write_metadata`` call starts its own ExifTool, unless it runs inside
``one_exiftool_process()``, which a job writing many photos opens once.
"""

import logging
import os
import queue
import re
import threading
import time
from collections.abc import Iterator, Mapping, Sequence
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass

import exiftool

from api.metadata.reader import sidecar_for_write
from api.runtime import binaries

logger = logging.getLogger(__name__)

# One tag's value: a list writes one argument per item.
TagValue = str | int | list[str]

# A write may take this long, plus a second per WRITE_BYTES_PER_SECOND of the
# target: ExifTool copies the whole file (a long video) to a temporary file.
WRITE_TIMEOUT_SECONDS = 60
WRITE_BYTES_PER_SECOND = 10 * 1024 * 1024
# How long a stopping ExifTool gets to exit before it is killed.
STOP_TIMEOUT_SECONDS = 10

_SUMMARY = re.compile(
    r"^\s*(\d+) (?:image files (updated|created|unchanged)"
    r"|files weren't (updated) due to errors)",
    re.MULTILINE,
)
_STATUS = re.compile(rb"\{status (\d+)\}\s*$")


class MetadataWriteError(Exception):
    """ExifTool did not write the requested tags into ``path``.

    The message is ExifTool's own (its path replaced by "the file"), so it can
    be logged and shown to the user.
    """

    def __init__(self, path: str, message: str) -> None:
        super().__init__(message.replace(path, "the file"))
        self.path = path

    def __reduce__(self) -> tuple[type["MetadataWriteError"], tuple[str, str]]:
        # Picklable (django-q, the parallel test runner) with both arguments.
        return type(self), (self.path, str(self))


@dataclass(frozen=True)
class WriteResult:
    """What ExifTool reported for a write that landed."""

    # Files ExifTool updated or created.
    updated: int
    # Files it left as they were: a removal of a tag the file did not have.
    unchanged: int
    # Warnings that did not concern the requested tags ("[minor] ...").
    warnings: tuple[str, ...] = ()


def _argument(tag: str, value: str | int) -> bytes:
    """One ``-TAG=value`` argument for the ExifTool process.

    ExifTool runs as ``exiftool -stay_open True -@ -``, which reads one
    argument per line, so a line break inside a value would end this argument
    and start another one (``-if <perl>`` runs code). Callers pass single-line
    values (face_regions flattens person names); this is the backstop.
    """
    argument = f"-{tag}={value}"
    if "\n" in argument or "\r" in argument:
        raise ValueError(f"refusing to write {tag}: the value contains a line break")
    return os.fsencode(argument)


class ExifToolProcess:
    """``exiftool -stay_open``: one process for many writes.

    Its stderr goes into the same pipe as stdout, so the warnings and errors
    of a command arrive before the ``{readyN}`` that ends it. A thread reads
    the pipe, which lets ``execute`` give up after a timeout on every
    platform (Windows has no ``select`` for pipes).
    """

    def __init__(self) -> None:
        self._process = binaries.start_tool(
            "exiftool",
            ["-stay_open", "True", "-@", "-", "-common_args", "-n"],
            stdin=binaries.PIPE,
            stdout=binaries.PIPE,
            stderr=binaries.STDOUT,
        )
        self._output: queue.Queue[bytes] = queue.Queue()
        self._pending = b""
        self._commands = 0
        self._stopped = False
        threading.Thread(
            target=self._pump, name="exiftool-writer-output", daemon=True
        ).start()

    @property
    def alive(self) -> bool:
        """Whether it still takes commands: not stopped, killed or crashed."""
        return not self._stopped and self._process.poll() is None

    def _pump(self) -> None:
        stdout = self._process.stdout
        assert stdout is not None
        while chunk := os.read(stdout.fileno(), 65536):
            self._output.put(chunk)
        self._output.put(b"")  # end of output: the process is gone

    def execute(self, arguments: Sequence[bytes], timeout: float) -> tuple[str, int]:
        """Run one command; ExifTool's output and exit status.

        Raises ``OSError`` when ExifTool has exited, ``TimeoutError`` when
        it did not answer within ``timeout`` seconds (it is killed then).
        """
        self._commands += 1
        ready = b"{ready%d}" % self._commands
        command = [*arguments, b"-echo3", b"{status ${status}}"]
        stdin = self._process.stdin
        assert stdin is not None
        try:
            stdin.write(b"\n".join([*command, b"-execute%d" % self._commands, b""]))
            stdin.flush()
        except OSError:
            self._stopped = True
            raise
        deadline = time.monotonic() + timeout
        while ready not in self._pending:
            try:
                chunk = self._output.get(timeout=max(deadline - time.monotonic(), 0))
            except queue.Empty:
                self.kill()
                raise TimeoutError(f"ExifTool did not answer within {timeout:g} s")
            if not chunk:
                self._stopped = True
                raise OSError("ExifTool exited")
            self._pending += chunk
        output, _, self._pending = self._pending.partition(ready)
        output = output.rstrip()
        status = _STATUS.search(output)
        if status is None:
            raise OSError("ExifTool answered without an exit status")
        text = output[: status.start()].decode("utf-8", errors="replace")
        return text, int(status.group(1))

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


def _start_process() -> ExifToolProcess:
    return ExifToolProcess()


class _Session:
    """The ExifTool process of a run of writes, started on the first write."""

    def __init__(self) -> None:
        self._process: ExifToolProcess | None = None

    def write(self, target: str, arguments: list[bytes]) -> WriteResult:
        if self._process is None or not self._process.alive:
            if self._process is not None:
                self._process.close()  # it died: reap it, start another
            try:
                self._process = _start_process()
            except binaries.ToolError as error:
                raise MetadataWriteError(target, str(error)) from error
        try:
            size = os.path.getsize(target)
        except OSError:
            size = 0  # a sidecar ExifTool is about to create
        timeout = WRITE_TIMEOUT_SECONDS + size / WRITE_BYTES_PER_SECOND
        command = [*arguments, b"-overwrite_original", os.fsencode(target)]
        try:
            output, status = self._process.execute(command, timeout)
        except (OSError, TimeoutError) as error:
            raise MetadataWriteError(target, str(error)) from error
        return _outcome(target, arguments, output, status)

    def close(self) -> None:
        if self._process is not None:
            self._process.close()


_session: ContextVar[_Session | None] = ContextVar("exiftool_writer", default=None)


@contextmanager
def one_exiftool_process() -> Iterator[None]:
    """Run every ``write_metadata`` inside the block through one ExifTool.

    ExifTool takes a moment to start (Perl), so a job writing many photos
    opens this once. Nested blocks share the outer one's process.
    """
    if _session.get() is not None:
        yield
        return
    session = _Session()
    token = _session.set(session)
    try:
        yield
    finally:
        _session.reset(token)
        session.close()


def _requested_tags(arguments: list[bytes]) -> tuple[set[str], bool]:
    """The tag names of ``-TAG=value`` arguments, and whether one sets a value.

    A ``-TAG=`` with nothing after it removes the tag, which leaves a file
    without it unchanged; that is no failure.
    """
    names: set[str] = set()
    sets_a_value = False
    for argument in arguments:
        tag, _, value = os.fsdecode(argument)[1:].partition("=")
        names.add(tag)
        names.add(tag.rsplit(":", 1)[-1])
        sets_a_value = sets_a_value or value != ""
    return names, sets_a_value


def _outcome(
    target: str, arguments: list[bytes], output: str, status: int
) -> WriteResult:
    """``output`` and ``status`` of one ExifTool write, or the error they report."""
    counts = {"updated": 0, "created": 0, "unchanged": 0, "failed": 0}
    for count, outcome, failed in _SUMMARY.findall(output):
        counts["failed" if failed else outcome] += int(count)
    lines = [line.strip() for line in output.splitlines()]
    errors = [line for line in lines if line.startswith("Error")]
    warnings = [line for line in lines if line.startswith("Warning:")]
    serious = [warning for warning in warnings if "[minor]" not in warning]

    if status != 0 or counts["failed"]:
        reasons = errors or serious or ["ExifTool could not write the file"]
        raise MetadataWriteError(target, reasons[0])
    names, sets_a_value = _requested_tags(arguments)
    for warning in warnings:
        if "[minor]" in warning:
            continue
        if any(re.search(rf"\b{re.escape(name)}\b", warning) for name in names):
            raise MetadataWriteError(target, warning)
    updated = counts["updated"] + counts["created"]
    if updated == 0 and sets_a_value:
        raise MetadataWriteError(
            target, "ExifTool cannot store these tags in this file; nothing was written"
        )
    return WriteResult(updated, counts["unchanged"], tuple(warnings))


def write_metadata(
    media_file: str, tags: Mapping[str, TagValue], use_sidecar: bool = True
) -> WriteResult:
    """Write ``tags`` into ``media_file`` or its XMP sidecar.

    The sidecar is the one ``sidecar_for_write`` picks. Raises
    ``MetadataWriteError`` when ExifTool did not write them (see ``_outcome``).
    """
    target = sidecar_for_write(media_file) if use_sidecar else media_file
    if "\n" in target or "\r" in target:
        raise MetadataWriteError(target, "the file name contains a line break")
    arguments: list[bytes] = []
    for tag, value in tags.items():
        values: list[str | int] = list(value) if isinstance(value, list) else [value]
        arguments.extend(_argument(tag, item) for item in values)
    logger.debug("Writing %s to %s", tags, target)

    with one_exiftool_process():
        session = _session.get()
        assert session is not None
        return session.write(target, arguments)


def read_orientation(media_file: str) -> int | None:
    """The EXIF Orientation stored in *media_file* itself.

    Reads the media file with exiftool directly, never a sidecar and never the
    exif service, so it tells what a write just left on disk.

    A file without the tag is upright, so that reads as 1. Returns None when
    the file cannot be read at all.
    """
    try:
        with exiftool.ExifTool(binaries.exiftool()) as et:
            value = et.get_tag("EXIF:Orientation", media_file)
    except Exception:
        logger.exception("could not read the orientation of %s", media_file)
        return None
    if value is None:
        return 1
    return value if isinstance(value, int) else None
