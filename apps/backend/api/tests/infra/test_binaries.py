"""api.runtime.binaries runs every external tool: a timeout is mandatory and it holds.

The tool in these tests is the test's own Python interpreter, named by path,
so they run wherever the suite does.
"""

import inspect
import sys
import tempfile
import time
from unittest import mock

from django.test import SimpleTestCase

from api.runtime import binaries
from api.tests.utils import write_hanging_tool

PYTHON = sys.executable


def python(code):
    return ["-c", code]


class RunToolSignatureTest(SimpleTestCase):
    def test_timeout_is_keyword_only_and_has_no_default(self):
        """A call without a timeout must not type-check, let alone run."""
        timeout = inspect.signature(binaries.run_tool).parameters["timeout"]
        self.assertEqual(timeout.kind, inspect.Parameter.KEYWORD_ONLY)
        self.assertIs(timeout.default, inspect.Parameter.empty)

    def test_a_call_without_a_timeout_fails(self):
        with self.assertRaises(TypeError):
            binaries.run_tool(PYTHON, python("pass"))


class RunToolTest(SimpleTestCase):
    def test_returns_what_the_tool_printed_decoded_as_utf8(self):
        """UTF-8 whatever the locale says (cp1252 on a Windows box)."""
        code = "import sys; sys.stdout.buffer.write('h\\u00e9llo'.encode('utf-8'))"
        result = binaries.run_tool(PYTHON, python(code), timeout=30, text=True)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, "héllo")

    def test_bytes_unless_text_is_asked_for(self):
        result = binaries.run_tool(PYTHON, python("print('x')"), timeout=30)
        self.assertEqual(result.stdout.strip(), b"x")

    def test_stdin_is_empty(self):
        """A tool that reads stdin must not wait on the server's terminal."""
        result = binaries.run_tool(
            PYTHON, python("import sys; print(repr(sys.stdin.read()))"), timeout=30
        )
        self.assertEqual(result.stdout.strip(), b"''")

    def test_a_missing_tool_raises_tool_missing(self):
        with (
            self.assertLogs("api.runtime.binaries", "WARNING") as logs,
            self.assertRaises(binaries.ToolMissingError) as raised,
        ):
            binaries.run_tool("librephotos-no-such-tool", [], timeout=30)
        self.assertEqual(raised.exception.name, "librephotos-no-such-tool")
        self.assertEqual(len(logs.output), 1)

    def test_a_non_zero_exit_raises_with_the_status_and_stderr(self):
        code = "import sys; sys.stderr.write('moov atom not found'); sys.exit(3)"
        with (
            self.assertLogs("api.runtime.binaries", "WARNING") as logs,
            self.assertRaises(binaries.ToolFailedError) as raised,
        ):
            binaries.run_tool(PYTHON, python(code), timeout=30)
        self.assertEqual(raised.exception.returncode, 3)
        self.assertEqual(raised.exception.stderr_tail, "moov atom not found")
        self.assertIn("status 3", str(raised.exception))
        [line] = logs.output
        self.assertIn("status 3", line)
        self.assertIn("moov atom not found", line)

    def test_without_check_a_non_zero_exit_is_returned_quietly(self):
        code = "import sys; sys.stderr.write('partial'); sys.exit(1)"
        with mock.patch.object(binaries.logger, "warning") as warning:
            result = binaries.run_tool(
                PYTHON, python(code), timeout=30, check=False, text=True
            )
        self.assertEqual((result.returncode, result.stderr), (1, "partial"))
        warning.assert_not_called()

    def test_only_the_end_of_stderr_is_kept(self):
        limit = binaries.STDERR_TAIL_CHARS
        code = f"import sys; sys.stderr.write('a' * {limit * 3} + 'END'); sys.exit(1)"
        with (
            self.assertLogs("api.runtime.binaries", "WARNING"),
            self.assertRaises(binaries.ToolFailedError) as raised,
        ):
            binaries.run_tool(PYTHON, python(code), timeout=30)
        tail = raised.exception.stderr_tail
        self.assertEqual(len(tail), limit)
        self.assertTrue(tail.endswith("END"))

    def test_a_tool_saying_nothing_has_a_readable_tail(self):
        self.assertEqual(binaries.stderr_tail(b""), "no output")
        self.assertEqual(binaries.stderr_tail(None), "no output")


class RunToolTimeoutTest(SimpleTestCase):
    def test_a_hung_tool_is_killed_at_the_timeout(self):
        started = time.monotonic()
        with (
            self.assertLogs("api.runtime.binaries", "WARNING") as logs,
            self.assertRaises(binaries.ToolFailedError) as raised,
        ):
            binaries.run_tool(PYTHON, python("import time; time.sleep(5)"), timeout=0.5)
        self.assertLess(time.monotonic() - started, 4)
        self.assertIsNone(raised.exception.returncode)
        self.assertIn("did not finish within 0.5 s", str(raised.exception))
        self.assertEqual(len(logs.output), 1)

    def test_what_it_said_before_hanging_is_kept(self):
        code = "import sys, time; sys.stderr.write('frame=  12'); sys.stderr.flush(); time.sleep(5)"
        with (
            self.assertLogs("api.runtime.binaries", "WARNING"),
            self.assertRaises(binaries.ToolFailedError) as raised,
        ):
            binaries.run_tool(PYTHON, python(code), timeout=1)
        self.assertEqual(raised.exception.stderr_tail, "frame=  12")

    def test_the_processes_it_started_go_with_it(self):
        """A child holding the pipes would otherwise keep the call waiting.

        The Windows exiftool.exe is a launcher for perl.exe, and the stand-in
        here sleeps in a child as well. The call returns well within the grace
        period it allows a killed tool to close its pipes, so the child was
        killed rather than waited for.
        """
        with tempfile.TemporaryDirectory() as directory:
            tool = write_hanging_tool(directory)
            started = time.monotonic()
            with (
                self.assertLogs("api.runtime.binaries", "WARNING"),
                self.assertRaises(binaries.ToolFailedError),
            ):
                binaries.run_tool(tool, ["-anything"], timeout=0.5)
            self.assertLess(time.monotonic() - started, binaries.KILL_GRACE_SECONDS)


class StartToolTest(SimpleTestCase):
    def test_starts_the_tool_and_hands_it_over(self):
        process = binaries.start_tool(
            PYTHON, python("print('frame')"), stdout=binaries.PIPE
        )
        self.addCleanup(process.kill)
        stdout, _ = process.communicate(timeout=30)
        self.assertEqual(stdout.strip(), b"frame")
        self.assertEqual(process.returncode, 0)

    def test_a_missing_tool_raises_tool_missing(self):
        with (
            self.assertLogs("api.runtime.binaries", "WARNING"),
            self.assertRaises(binaries.ToolMissingError),
        ):
            binaries.start_tool("librephotos-no-such-tool", [])

    def test_wait_says_none_while_it_runs_and_the_status_after(self):
        process = binaries.start_tool(
            PYTHON, python("import sys, time; time.sleep(1); sys.exit(4)")
        )
        self.addCleanup(process.kill)
        self.assertIsNone(binaries.wait(process, 0.05))
        self.assertEqual(binaries.wait(process, 30), 4)


class AvailableTest(SimpleTestCase):
    def test_a_tool_that_is_there(self):
        self.assertTrue(binaries.available(PYTHON))

    def test_a_tool_that_is_not(self):
        self.assertFalse(binaries.available("librephotos-no-such-tool"))
