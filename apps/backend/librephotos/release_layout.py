from __future__ import annotations

import os
import platform
import sys
from dataclasses import dataclass
from pathlib import Path

MARKER_NAME = ".librephotos-update.json"
BUILD_INFO = "build_info.json"
DOCS = "https://docs.librephotos.com/docs/installation/"
BUNDLE_ID = "com.librephotos.server"
APP_NAME = "LibrePhotos Server"
APP_BUNDLE = f"{APP_NAME}.app"
MACOS_BINARY_DIR = ("Contents", "Resources", "librephotos")
MACOS_LAUNCHER = ("Contents", "MacOS", APP_NAME)
MACOS_SKELETON = (
    ((), frozenset({"Contents"})),
    (
        ("Contents",),
        frozenset(
            {
                "Info.plist",
                "PkgInfo",
                "MacOS",
                "Resources",
                "_CodeSignature",
                "CodeResources",
            }
        ),
    ),
    (("Contents", "MacOS"), frozenset({APP_NAME})),
    (
        ("Contents", "Resources"),
        frozenset({"librephotos", "LibrePhotos.icns", "uninstall.sh"}),
    ),
)
ARCHITECTURES = {"amd64": "x64", "x86_64": "x64", "arm64": "arm64", "aarch64": "arm64"}


@dataclass(frozen=True)
class ReleaseLayout:
    platform: str
    top_dir: str
    binary_name: str
    launcher_parts: tuple[str, ...]
    binary_parts: tuple[str, ...] = ()
    checksums_name: str = "SHA256SUMS"
    skeleton: tuple[tuple[tuple[str, ...], frozenset[str]], ...] = ()
    marker_inside: bool = True
    docs_page: str = "windows-standalone"
    install_type: str = "windows"

    @property
    def archive_name(self) -> str:
        return f"librephotos-{self.platform}.zip"

    @property
    def signature_name(self) -> str:
        return f"{self.checksums_name}.minisig"

    @property
    def docs_url(self) -> str:
        return DOCS + self.docs_page

    @property
    def is_bundle(self) -> bool:
        return bool(self.binary_parts)

    def binary_folder(self, folder: Path) -> Path:
        return folder.joinpath(*self.binary_parts)

    def binary(self, folder: Path) -> Path:
        return self.binary_folder(folder) / self.binary_name

    def launcher(self, folder: Path) -> Path:
        return folder.joinpath(*self.launcher_parts)

    def program_folder(self, install_root: Path) -> Path:
        folder = install_root
        for _ in self.binary_parts:
            folder = folder.parent
        return folder

    def marker(self, folder: Path) -> Path:
        if self.marker_inside:
            return folder / MARKER_NAME
        return folder.with_name(folder.name + MARKER_NAME)

    def build_info(self, folder: Path) -> Path:
        return self.binary_folder(folder) / BUILD_INFO


WINDOWS = ReleaseLayout(
    platform="windows-x64",
    top_dir="librephotos",
    binary_name="librephotos.exe",
    launcher_parts=("librephotos.exe",),
)


def macos(architecture: str) -> ReleaseLayout:
    return ReleaseLayout(
        platform=f"macos-{architecture}",
        top_dir=APP_BUNDLE,
        binary_name="librephotos",
        launcher_parts=MACOS_LAUNCHER,
        binary_parts=MACOS_BINARY_DIR,
        checksums_name=f"SHA256SUMS-macos-{architecture}",
        skeleton=MACOS_SKELETON,
        marker_inside=False,
        docs_page="macos",
        install_type="macos",
    )


MACOS_ARM64 = macos("arm64")


def architecture(machine: str) -> str:
    lowered = machine.lower()
    return ARCHITECTURES.get(lowered, lowered)


def layout_for(system: str, machine: str) -> ReleaseLayout:
    if system == "darwin":
        return macos(architecture(machine))
    return WINDOWS


def current() -> ReleaseLayout:
    return layout_for(sys.platform, platform.machine())


def skeleton_extras(layout: ReleaseLayout, folder: Path) -> list[str] | None:
    extras: list[str] = []
    for parts, allowed in layout.skeleton:
        try:
            names = os.listdir(folder.joinpath(*parts))
        except OSError:
            return None
        prefix = "/".join(parts)
        extras += [
            f"{prefix}/{name}" if prefix else name
            for name in names
            if name not in allowed
        ]
    return sorted(extras)
