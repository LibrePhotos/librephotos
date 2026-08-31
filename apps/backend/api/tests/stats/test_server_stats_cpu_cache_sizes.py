"""Regression tests for issue #1864.

py-cpuinfo can report cache sizes as non-numeric strings (e.g. "1.3 MiB") on some
CPUs, which broke the frontend's numeric stats schema. The backend must normalize
those fields to ints (or drop them) before returning cpu_info.
"""

from unittest.mock import patch

from django.test import TestCase

from api.stats import _coerce_cache_size, get_server_stats


class CoerceCacheSizeTest(TestCase):
    def test_int_passthrough(self):
        self.assertEqual(_coerce_cache_size(32768), 32768)

    def test_zero_passthrough(self):
        self.assertEqual(_coerce_cache_size(0), 0)

    def test_binary_unit_strings(self):
        self.assertEqual(_coerce_cache_size("32 KiB"), 32768)
        self.assertEqual(_coerce_cache_size("6 MiB"), 6291456)

    def test_fractional_string(self):
        # The exact value py-cpuinfo fails to parse and returns as a string.
        self.assertEqual(_coerce_cache_size("1.3 MiB"), round(1.3 * 1024 * 1024))

    def test_unparseable_returns_none(self):
        self.assertIsNone(_coerce_cache_size("not a size"))
        self.assertIsNone(_coerce_cache_size(None))


class ServerStatsCpuInfoTest(TestCase):
    @patch("cpuinfo.get_cpu_info")
    def test_string_cache_sizes_are_coerced_to_int(self, mock_get_cpu_info):
        mock_get_cpu_info.return_value = {
            "brand_raw": "Intel(R) Xeon(R) Gold 6148",
            "l1_data_cache_size": "1.3 MiB",  # the value the issue reported as a string
            "l1_instruction_cache_size": "32 KiB",
            "l2_cache_size": 1048576,  # already an int
            "l3_cache_size": "27.5 MiB",
        }
        stats = get_server_stats()
        cpu_info = stats["cpu_info"]
        for field in (
            "l1_data_cache_size",
            "l1_instruction_cache_size",
            "l2_cache_size",
            "l3_cache_size",
        ):
            self.assertIsInstance(
                cpu_info[field],
                int,
                f"{field} should be numeric, got {cpu_info[field]!r}",
            )

    @patch("cpuinfo.get_cpu_info")
    def test_unparseable_cache_size_is_dropped(self, mock_get_cpu_info):
        mock_get_cpu_info.return_value = {
            "brand_raw": "Weird CPU",
            "l1_data_cache_size": "unknown",
        }
        stats = get_server_stats()
        # Dropped rather than emitted as a non-numeric string.
        self.assertNotIn("l1_data_cache_size", stats["cpu_info"])
