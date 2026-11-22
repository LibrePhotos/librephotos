import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from unittest import TestCase, skipUnless
from unittest.mock import patch

from api.runtime import capacity

GB = 1024**3


def _tree(files: dict[str, str]) -> Path:
    root = Path(tempfile.mkdtemp())
    for name, text in files.items():
        path = root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text, encoding="ascii")
    return root


def _no_proc(root: Path) -> Path:
    return root / "missing-proc-cgroup"


class CgroupMemoryTest(TestCase):
    def test_v2_limit_and_usage_without_inactive_file(self):
        root = _tree(
            {
                "memory.max": str(2 * GB),
                "memory.current": str(GB),
                "memory.stat": f"anon 100\ninactive_file {GB // 4}\n",
            }
        )

        reading = capacity.cgroup_memory(root, _no_proc(root))

        self.assertEqual(
            capacity.MemoryReading(2 * GB, GB - GB // 4, "cgroup v2"), reading
        )

    def test_v2_max_means_no_limit(self):
        root = _tree({"memory.max": "max", "memory.current": "5"})

        self.assertIsNone(capacity.cgroup_memory(root, _no_proc(root)).limit)

    def test_v2_follows_the_process_cgroup(self):
        root = _tree({"lp/app/memory.max": str(GB), "lp/app/memory.current": "0"})
        proc = root / "proc"
        proc.write_text("0::/lp/app\n", encoding="ascii")

        self.assertEqual(GB, capacity.cgroup_memory(root, proc).limit)

    def test_v1_limit(self):
        root = _tree(
            {
                "memory/memory.limit_in_bytes": str(4 * GB),
                "memory/memory.usage_in_bytes": str(GB),
                "memory/memory.stat": "total_inactive_file 0\n",
            }
        )

        self.assertEqual(
            capacity.MemoryReading(4 * GB, GB, "cgroup v1"),
            capacity.cgroup_memory(root, _no_proc(root)),
        )

    def test_v1_huge_limit_means_none(self):
        root = _tree({"memory/memory.limit_in_bytes": str(1 << 62)})

        self.assertIsNone(capacity.cgroup_memory(root, _no_proc(root)).limit)

    def test_no_cgroup_is_the_host(self):
        root = _tree({})

        self.assertEqual(
            capacity.MemoryReading(None, None, "host"),
            capacity.cgroup_memory(root, _no_proc(root)),
        )


class CgroupCpuTest(TestCase):
    def test_v2_quota(self):
        root = _tree({"cpu.max": "250000 100000"})

        self.assertEqual(
            (2.5, "cgroup v2"), capacity.cgroup_cpu_limit(root, _no_proc(root))
        )

    def test_v2_max(self):
        root = _tree({"cpu.max": "max 100000"})

        self.assertEqual(
            (None, "cgroup v2"), capacity.cgroup_cpu_limit(root, _no_proc(root))
        )

    def test_v1_quota_and_unlimited(self):
        limited = _tree(
            {"cpu/cpu.cfs_quota_us": "200000", "cpu/cpu.cfs_period_us": "100000"}
        )
        unlimited = _tree(
            {"cpu/cpu.cfs_quota_us": "-1", "cpu/cpu.cfs_period_us": "100000"}
        )

        self.assertEqual(
            (2.0, "cgroup v1"), capacity.cgroup_cpu_limit(limited, _no_proc(limited))
        )
        self.assertEqual(
            (None, "cgroup v1"),
            capacity.cgroup_cpu_limit(unlimited, _no_proc(unlimited)),
        )


class DetectTest(TestCase):
    def _memory(self, total: int, available: int) -> SimpleNamespace:
        return SimpleNamespace(total=total, available=available)

    @skipUnless(sys.platform != "win32", "cgroups are Linux only")
    def test_container_limits_win_over_the_host(self):
        root = _tree(
            {
                "memory.max": str(2 * GB),
                "memory.current": str(GB + GB // 2),
                "cpu.max": "200000 100000",
            }
        )
        with (
            patch.object(
                capacity.psutil,
                "virtual_memory",
                return_value=self._memory(64 * GB, 60 * GB),
            ),
            patch.object(capacity, "_visible_cores", return_value=32),
        ):
            found = capacity.detect(root, _no_proc(root))

        self.assertEqual(
            capacity.Capacity(
                cores=2,
                cpu_source="cgroup v2",
                ram_total=2 * GB,
                ram_available=GB // 2,
                ram_source="cgroup v2",
            ),
            found,
        )

    def test_cgroup_reading_is_used_off_windows(self):
        reading = capacity.MemoryReading(3 * GB, GB, "cgroup v1")
        with (
            patch.object(capacity.sys, "platform", "linux"),
            patch.object(
                capacity.psutil,
                "virtual_memory",
                return_value=self._memory(16 * GB, 12 * GB),
            ),
            patch.object(capacity, "cgroup_memory", return_value=reading),
            patch.object(capacity, "cgroup_cpu_limit", return_value=(0.5, "cgroup v1")),
            patch.object(capacity, "_visible_cores", return_value=4),
        ):
            found = capacity.detect()

        self.assertEqual(
            (3 * GB, 2 * GB, "cgroup v1"),
            (found.ram_total, found.ram_available, found.ram_source),
        )
        self.assertEqual((1, "cgroup v1"), (found.cores, found.cpu_source))

    def test_a_limit_above_the_host_is_ignored(self):
        reading = capacity.MemoryReading(64 * GB, 0, "cgroup v2")
        with (
            patch.object(capacity.sys, "platform", "linux"),
            patch.object(
                capacity.psutil,
                "virtual_memory",
                return_value=self._memory(8 * GB, 6 * GB),
            ),
            patch.object(capacity, "cgroup_memory", return_value=reading),
            patch.object(capacity, "cgroup_cpu_limit", return_value=(None, "host")),
        ):
            found = capacity.detect()

        self.assertEqual(
            (8 * GB, 6 * GB, "host"),
            (found.ram_total, found.ram_available, found.ram_source),
        )

    def test_a_windows_job_object_limit(self):
        with (
            patch.object(capacity.sys, "platform", "win32"),
            patch.object(
                capacity.psutil,
                "virtual_memory",
                return_value=self._memory(32 * GB, 20 * GB),
            ),
            patch.object(capacity, "windows_job_memory_limit", return_value=4 * GB),
        ):
            found = capacity.detect()

        self.assertEqual(
            (4 * GB, 4 * GB, "job object"),
            (found.ram_total, found.ram_available, found.ram_source),
        )

    @skipUnless(sys.platform == "win32", "Windows only")
    def test_this_process_has_no_job_memory_limit_or_a_positive_one(self):
        limit = capacity.windows_job_memory_limit()

        self.assertTrue(limit is None or limit > 0)

    def test_this_machine(self):
        found = capacity.detect()

        self.assertGreaterEqual(found.cores, 1)
        self.assertGreater(found.ram_total, 0)
        self.assertLessEqual(found.ram_available, found.ram_total)
