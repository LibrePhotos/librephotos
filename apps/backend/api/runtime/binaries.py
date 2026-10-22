"""The external tools (ffmpeg, ffprobe, ExifTool, ...): where they are and how they run.

This is the only module that starts a tool (ruff TID251 bans ``subprocess``
elsewhere; ``api/runtime/supervisor.py`` supervises the sidecars on its own).

- :func:`run_tool` runs a tool to completion. The timeout has no default: a
  tool that hangs on one file must fail the call, never park a worker forever.
  On a timeout the tool and every process it started are killed.
- :func:`start_tool` starts a long-running tool whose lifetime the caller
  manages (the transcode cache, the live stream).
- :func:`available` says whether a tool is on PATH.

Paths are resolved with shutil.which. The ffmpeg-bin and exiftool-bin wheels
prepend their folders to PATH at interpreter start, and Windows' CreateProcess
searches System32 before PATH, so a bare "ffmpeg" could still pick up a stray
copy there; resolving first honours PATH order.
"""

import logging
import os
import shutil
import signal
import subprocess
from collections.abc import Sequence
from typing import IO, Literal, overload

logger = logging.getLogger(__name__)

# What a failure keeps of the tool's stderr: enough to identify it, small enough
# for one log line.
STDERR_TAIL_CHARS = 2048

# How long to wait for the pipes to close once a timed-out tool has been killed.
KILL_GRACE_SECONDS = 10

PIPE = subprocess.PIPE
DEVNULL = subprocess.DEVNULL
# As ``stderr``: into the same pipe as stdout.
STDOUT = subprocess.STDOUT

# A started tool, as start_tool returns it.
Process = subprocess.Popen[bytes]


class ToolError(Exception):
    """A tool could not be run, or did not finish successfully."""

    def __init__(self, name: str, message: str) -> None:
        super().__init__(message)
        self.name = name


class ToolMissingError(ToolError):
    """The tool is not installed, or could not be started."""

    def __init__(self, name: str, reason: str) -> None:
        super().__init__(name, f"{name} could not be started: {reason}")


class ToolFailedError(ToolError):
    """The tool exited with a non-zero status, or was killed after its timeout.

    ``returncode`` is None when it was killed; ``timeout`` is set only then.
    """

    def __init__(
        self,
        name: str,
        returncode: int | None,
        stderr_tail: str,
        timeout: float | None = None,
    ) -> None:
        if timeout is not None:
            message = f"{name} did not finish within {timeout:g} s: {stderr_tail}"
        else:
            message = f"{name} exited with status {returncode}: {stderr_tail}"
        super().__init__(name, message)
        self.returncode = returncode
        self.stderr_tail = stderr_tail


def resolve(name: str) -> str:
    return shutil.which(name) or name


def available(name: str) -> bool:
    """Whether ``name`` (a tool on PATH, or a path) can be found."""
    return shutil.which(name) is not None


def ffmpeg() -> str:
    return resolve("ffmpeg")


def exiftool() -> str:
    return resolve("exiftool")


def stderr_tail(stderr: bytes | str | None) -> str:
    """The last STDERR_TAIL_CHARS of ``stderr``, or "no output"."""
    if isinstance(stderr, bytes):
        stderr = stderr.decode("utf-8", errors="replace")
    text = (stderr or "").strip()
    return text[-STDERR_TAIL_CHARS:] or "no output"


@overload
def run_tool(
    name: str,
    args: Sequence[str],
    *,
    timeout: float,
    check: bool = True,
    text: Literal[False] = False,
) -> subprocess.CompletedProcess[bytes]: ...


@overload
def run_tool(
    name: str,
    args: Sequence[str],
    *,
    timeout: float,
    check: bool = True,
    text: Literal[True],
) -> subprocess.CompletedProcess[str]: ...


def run_tool(
    name: str,
    args: Sequence[str],
    *,
    timeout: float,
    check: bool = True,
    text: bool = False,
) -> subprocess.CompletedProcess[bytes] | subprocess.CompletedProcess[str]:
    """Run the tool ``name`` with ``args`` and return what it printed.

    ``name`` is a tool on PATH (``"ffmpeg"``) or a path. Its stdin is empty, and
    stdout and stderr are captured; with ``text`` they are decoded as UTF-8,
    whatever the locale says. Raises :class:`ToolMissingError` when the tool cannot
    be started and :class:`ToolFailedError` when it runs past ``timeout`` seconds
    (it is killed, with the processes it started) or, with ``check``, exits
    non-zero. Each raise logs one warning with the tool and the end of stderr,
    so callers need not log it again. Arguments are not logged: they hold paths.
    """
    command = [resolve(name), *args]
    try:
        process = subprocess.Popen(
            command,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            # Its own process group, so a timeout can kill whatever it started.
            start_new_session=True,
        )
    except OSError as error:
        logger.warning("%s could not be started: %s", name, error)
        raise ToolMissingError(name, str(error)) from error

    try:
        stdout, stderr = process.communicate(timeout=timeout)
    except subprocess.TimeoutExpired:
        _kill_tree(process)
        stderr = _drain_after_kill(process)
        failure = ToolFailedError(name, None, stderr_tail(stderr), timeout)
        logger.warning("%s", failure)
        raise failure from None
    except BaseException:
        # Interrupted (KeyboardInterrupt, a worker being stopped): the tool must
        # not outlive the call.
        _kill_tree(process)
        process.wait()
        raise

    if check and process.returncode != 0:
        failure = ToolFailedError(name, process.returncode, stderr_tail(stderr))
        logger.warning("%s", failure)
        raise failure
    if text:
        return subprocess.CompletedProcess(
            command,
            process.returncode,
            stdout.decode("utf-8", errors="replace"),
            stderr.decode("utf-8", errors="replace"),
        )
    return subprocess.CompletedProcess(command, process.returncode, stdout, stderr)


def _kill_tree(process: Process) -> None:
    """Kill ``process`` and the processes it started.

    Killing only the tool is not enough: a child that inherited its pipes keeps
    them open, and reading them to the end would then wait for that child. The
    Windows exiftool.exe is such a launcher, running ExifTool in a perl.exe
    child. On POSIX the tool leads its own process group (start_new_session);
    on Windows taskkill /T walks the process tree.
    """
    if os.name == "posix":
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except OSError:
            pass  # already gone
    else:
        try:
            subprocess.run(
                [resolve("taskkill"), "/F", "/T", "/PID", str(process.pid)],
                stdin=subprocess.DEVNULL,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                timeout=KILL_GRACE_SECONDS,
                check=False,
            )
        except OSError, subprocess.SubprocessError:
            logger.warning("taskkill failed for pid %s", process.pid, exc_info=True)
    process.kill()


def _drain_after_kill(process: Process) -> bytes:
    """What the killed tool had written to stderr, without waiting for ever.

    If a descendant escaped the kill and still holds the pipes, give up on the
    output rather than wait for it; the reader threads go when it does.
    """
    try:
        _, stderr = process.communicate(timeout=KILL_GRACE_SECONDS)
    except subprocess.TimeoutExpired:
        logger.warning("a killed tool still holds its pipes (pid %s)", process.pid)
        return b""
    return stderr


def start_tool(
    name: str,
    args: Sequence[str],
    *,
    stdin: int | None = DEVNULL,
    stdout: int | IO[bytes] | None = None,
    stderr: int | IO[bytes] | None = None,
) -> Process:
    """Start the tool ``name`` with ``args``; the caller waits for or kills it.

    For tools that run as long as their work does (a transcode), where no
    single timeout fits. stdin is empty unless it is PIPE (a tool fed
    commands, like ``exiftool -stay_open``); ``stdout``/``stderr`` take PIPE,
    DEVNULL, a file or None (inherit), and ``stderr`` also STDOUT. A new
    session, so a signal meant for the server's process group does not reach
    the tool half way through a file. Raises
    :class:`ToolMissingError` when it cannot be started.
    """
    try:
        return subprocess.Popen(
            [resolve(name), *args],
            stdin=stdin,
            stdout=stdout,
            stderr=stderr,
            start_new_session=True,
        )
    except OSError as error:
        logger.warning("%s could not be started: %s", name, error)
        raise ToolMissingError(name, str(error)) from error


def kill(process: Process) -> None:
    """Kill a started tool and the processes it started (see ``_kill_tree``)."""
    _kill_tree(process)
    process.wait()


def wait(process: Process, timeout: float) -> int | None:
    """The exit status of ``process``, or None if it is still running after ``timeout`` s."""
    try:
        return process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        return None
