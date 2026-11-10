"""The CPU part of /api/serverstats/ (api/dataviz/cpu_info.py), per platform.

The fixtures are what each platform reports; the expected values are the keys
and types py-cpuinfo answered, which ``CpuInfoSerializer`` declares.
"""

import subprocess
from unittest.mock import patch

from django.test import SimpleTestCase

from api.dataviz import cpu_info
from api.dataviz.cpu_info import (
    from_proc_cpuinfo,
    from_sys_cache,
    from_sysctl,
    from_windows_registry,
    get_cpu_info,
)
from api.serializers.server import CpuInfoSerializer

INTEL = """processor\t: 0
vendor_id\t: GenuineIntel
cpu family\t: 6
model\t\t: 85
model name\t: Intel(R) Xeon(R) Gold 6148 CPU @ 2.40GHz
stepping\t: 4
cpu MHz\t\t: 2394.374
cache size\t: 28160 KB
flags\t\t: fpu vme de pse tsc msr sse sse2 avx avx2
bogomips\t: 4788.74

processor\t: 1
vendor_id\t: GenuineIntel
model name\t: Intel(R) Xeon(R) Gold 6148 CPU @ 2.40GHz
"""

# An Ampere/Neoverse server (Hetzner CAX): no vendor, no model name, no MHz.
NEOVERSE = """processor\t: 0
BogoMIPS\t: 50.00
Features\t: fp asimd evtstrm aes pmull sha1 sha2 crc32 atomics fphp asimdhp cpuid
CPU implementer\t: 0x41
CPU architecture: 8
CPU variant\t: 0x3
CPU part\t: 0xd0c
CPU revision\t: 1
"""

RASPBERRY_PI = """processor\t: 0
model name\t: ARMv7 Processor rev 4 (v7l)
BogoMIPS\t: 38.40
Features\t: half thumb fastmult vfp edsp neon vfpv3 tls vfpv4 idiva idivt vfpd32 lpae evtstrm crc32
CPU implementer\t: 0x41

Hardware\t: BCM2835
Revision\t: a02082
Model\t\t: Raspberry Pi 3 Model B Rev 1.2
"""

SYS_CACHE = {
    "index0/level": "1",
    "index0/type": "Data",
    "index0/size": "32K",
    "index1/level": "1",
    "index1/type": "Instruction",
    "index1/size": "32K",
    "index2/level": "2",
    "index2/type": "Unified",
    "index2/size": "1024K",
    "index2/coherency_line_size": "64",
    "index2/ways_of_associativity": "16",
    "index3/level": "3",
    "index3/type": "Unified",
    "index3/size": "28160K",
}

WINDOWS = {
    "ProcessorNameString": "AMD Ryzen 5 2600X Six-Core Processor           ",
    "VendorIdentifier": "AuthenticAMD",
    "Identifier": "AMD64 Family 23 Model 8 Stepping 2",
    "~MHz": 3900,
}

INTEL_MAC = {
    "machdep.cpu.brand_string": "Intel(R) Core(TM) i7-8850H CPU @ 2.60GHz",
    "machdep.cpu.vendor": "GenuineIntel",
    "machdep.cpu.features": "FPU VME SSE SSE2",
    "machdep.cpu.leaf7_features": "AVX2 BMI1",
    "machdep.cpu.family": 6,
    "machdep.cpu.model": 158,
    "machdep.cpu.stepping": 10,
    "hw.cpufrequency": 2600000000,
    "hw.l2cachesize": 262144,
    "hw.l3cachesize": 9437184,
}

APPLE_SILICON = {
    "machdep.cpu.brand_string": "Apple M2",
    "hw.l2cachesize": 4194304,
    "hw.l1dcachesize": 65536,
}


class PlatformReadersTest(SimpleTestCase):
    def test_linux_x86(self):
        self.assertEqual(
            from_proc_cpuinfo(INTEL),
            {
                "vendor_id_raw": "GenuineIntel",
                "brand_raw": "Intel(R) Xeon(R) Gold 6148 CPU @ 2.40GHz",
                "flags": sorted("fpu vme de pse tsc msr sse sse2 avx avx2".split()),
                "stepping": 4,
                "model": 85,
                "family": 6,
                "hz_advertised": [2400000000, 0],
                "hz_advertised_friendly": "2.4000 GHz",
                "hz_actual": [2394374000, 0],
                "hz_actual_friendly": "2.3944 GHz",
            },
        )

    def test_linux_arm_server_without_a_model_name(self):
        self.assertEqual(
            from_proc_cpuinfo(NEOVERSE),
            {
                "flags": sorted(
                    "fp asimd evtstrm aes pmull sha1 sha2 crc32 atomics fphp "
                    "asimdhp cpuid".split()
                ),
            },
        )

    def test_linux_raspberry_pi(self):
        info = from_proc_cpuinfo(RASPBERRY_PI)
        self.assertEqual(info["brand_raw"], "ARMv7 Processor rev 4 (v7l)")
        self.assertEqual(info["hardware_raw"], "BCM2835")
        self.assertIn("neon", info["flags"])
        self.assertNotIn("model", info)  # "Model" names the board, not a number

    def test_linux_cache_sizes(self):
        self.assertEqual(
            from_sys_cache(SYS_CACHE.get),
            {
                "l1_data_cache_size": 32768,
                "l1_instruction_cache_size": 32768,
                "l2_cache_size": 1048576,
                "l2_cache_line_size": 64,
                "l2_cache_associativity": 16,
                "l3_cache_size": 28835840,
            },
        )
        self.assertEqual(from_sys_cache(lambda name: None), {})

    def test_windows(self):
        self.assertEqual(
            from_windows_registry(WINDOWS),
            {
                "brand_raw": "AMD Ryzen 5 2600X Six-Core Processor",
                "vendor_id_raw": "AuthenticAMD",
                "family": 23,
                "model": 8,
                "stepping": 2,
                "hz_advertised": [3900000000, 0],
                "hz_advertised_friendly": "3.9000 GHz",
                "hz_actual": [3900000000, 0],
                "hz_actual_friendly": "3.9000 GHz",
            },
        )

    def test_macos_intel(self):
        info = from_sysctl(INTEL_MAC.get)
        self.assertEqual(info["brand_raw"], "Intel(R) Core(TM) i7-8850H CPU @ 2.60GHz")
        self.assertEqual(info["flags"], ["avx2", "bmi1", "fpu", "sse", "sse2", "vme"])
        self.assertEqual(
            (info["family"], info["model"], info["stepping"]), (6, 158, 10)
        )
        self.assertEqual(info["hz_actual_friendly"], "2.6000 GHz")
        self.assertEqual(info["l3_cache_size"], 9437184)

    def test_macos_apple_silicon(self):
        self.assertEqual(
            from_sysctl(APPLE_SILICON.get),
            {
                "brand_raw": "Apple M2",
                "l2_cache_size": 4194304,
                "l1_data_cache_size": 65536,
            },
        )


class GetCpuInfoTest(SimpleTestCase):
    def test_the_answer_validates_against_the_declared_shape(self):
        for platform_name, reader in (
            (
                "linux",
                lambda: {**from_proc_cpuinfo(INTEL), **from_sys_cache(SYS_CACHE.get)},
            ),
            ("linux", lambda: from_proc_cpuinfo(NEOVERSE)),
            ("win32", lambda: from_windows_registry(WINDOWS)),
            ("darwin", lambda: from_sysctl(APPLE_SILICON.get)),
        ):
            with (
                self.subTest(platform=platform_name),
                patch.object(cpu_info.sys, "platform", platform_name),
                patch.dict(cpu_info._READERS, {platform_name: reader}),
            ):
                info = get_cpu_info()
                serializer = CpuInfoSerializer(data=info)
                self.assertTrue(serializer.is_valid(), serializer.errors)
                self.assertEqual(set(serializer.validated_data), set(info))

    def test_always_the_base_keys(self):
        info = get_cpu_info()
        for key in (
            "python_version",
            "cpuinfo_version",
            "cpuinfo_version_string",
            "arch",
            "bits",
            "count",
            "arch_string_raw",
        ):
            self.assertIn(key, info)
        self.assertRegex(
            info["python_version"], r"^\d+\.\d+\.\d+\.\w+\.\d+ \((32|64) bit\)$"
        )
        self.assertEqual(
            (info["cpuinfo_version"], info["cpuinfo_version_string"]), ([], "")
        )

    def test_arch_names(self):
        for machine, arch in (
            ("x86_64", "X86_64"),
            ("AMD64", "X86_64"),
            ("i686", "X86_32"),
            ("aarch64", "ARM_8"),
            ("arm64", "ARM_8"),
            ("armv7l", "ARM_7"),
            ("ppc64le", "PPC_64"),
            ("s390x", "S390X"),
            ("riscv64", "RISCV_64"),
        ):
            with self.subTest(machine=machine):
                self.assertEqual(cpu_info._arch(machine), arch)

    def test_a_failing_platform_reader_leaves_only_the_base_keys(self):
        def broken():
            raise OSError("no /proc here")

        with (
            patch.object(cpu_info.sys, "platform", "linux"),
            patch.dict(cpu_info._READERS, {"linux": broken}),
        ):
            info = get_cpu_info()
        self.assertEqual(len(info), 7)

    def test_linux_runs_no_subprocess(self):
        files = {cpu_info.PROC_CPUINFO: INTEL}
        with (
            patch.object(cpu_info.sys, "platform", "linux"),
            patch.object(cpu_info, "_read_text", side_effect=files.get),
            patch.object(subprocess, "Popen", side_effect=AssertionError("spawned")),
        ):
            info = get_cpu_info()
        self.assertEqual(info["brand_raw"], "Intel(R) Xeon(R) Gold 6148 CPU @ 2.40GHz")

    def test_this_machine(self):
        # Whatever the platform running the tests reports fits the shape.
        serializer = CpuInfoSerializer(data=get_cpu_info())
        self.assertTrue(serializer.is_valid(), serializer.errors)
