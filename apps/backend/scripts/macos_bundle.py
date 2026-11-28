from __future__ import annotations

import argparse
import json
import os
import plistlib
import shutil
import struct
import subprocess
import sys
import tempfile
import time
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from librephotos import release_layout

MACOS = BACKEND / "macos"
LAUNCHER_SOURCE = MACOS / "launcher.c"
UNINSTALL_SCRIPT = MACOS / "uninstall.sh"
ICON_SOURCE = BACKEND.parent / "frontend" / "public" / "icons" / "icon-512x512.png"
ICON_NAME = "LibrePhotos.icns"
MINIMUM_MACOS = "14.0"
VOLUME_NAME = release_layout.APP_NAME
DMG_PREFIX = "LibrePhotos-Server"
IDENTITY_ENV = "APPLE_SIGNING_IDENTITY"
KEYCHAIN_ENV = "APPLE_KEYCHAIN"
NOTARY_KEY_ENV = "APPLE_API_KEY_PATH"
NOTARY_KEY_ID_ENV = "APPLE_API_KEY_ID"
NOTARY_ISSUER_ENV = "APPLE_API_ISSUER"
AD_HOC = "-"
HDIUTIL_ATTEMPTS = 5
ICON_SIZES = (16, 32, 128, 256, 512)

ENTITLEMENTS = {
    "com.apple.security.cs.allow-jit": True,
    "com.apple.security.cs.allow-unsigned-executable-memory": True,
    "com.apple.security.cs.disable-library-validation": True,
}

USAGE_DESCRIPTIONS = {
    "NSDesktopFolderUsageDescription": "LibrePhotos reads the photos you choose to add to your library.",
    "NSDocumentsFolderUsageDescription": "LibrePhotos reads the photos you choose to add to your library.",
    "NSDownloadsFolderUsageDescription": "LibrePhotos reads the photos you choose to add to your library.",
    "NSRemovableVolumesUsageDescription": "LibrePhotos reads photos from the drives you add to your library.",
    "NSNetworkVolumesUsageDescription": "LibrePhotos reads photos from the network drives you add to your library.",
    "NSLocalNetworkUsageDescription": "LibrePhotos serves your library to the browsers and phones you connect to it.",
}

MH_MAGICS = {
    b"\xfe\xed\xfa\xce": ">",
    b"\xfe\xed\xfa\xcf": ">",
    b"\xce\xfa\xed\xfe": "<",
    b"\xcf\xfa\xed\xfe": "<",
}
FAT_MAGICS = (b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf")
MH_EXECUTE = 2


def run(command: Sequence[str | Path]) -> None:
    print("+", " ".join(str(part) for part in command), flush=True)
    subprocess.run([str(part) for part in command], check=True)


def thin_filetype(header: bytes) -> int | None:
    order = MH_MAGICS.get(header[:4])
    if order is None or len(header) < 16:
        return None
    return struct.unpack(f"{order}I", header[12:16])[0]


def first_slice_offset(header: bytes) -> int | None:
    if header[:4] not in FAT_MAGICS or len(header) < 8:
        return None
    count = struct.unpack(">I", header[4:8])[0]
    if not 0 < count < 32:
        return None
    if header[:4] == FAT_MAGICS[0]:
        return struct.unpack(">I", header[16:20])[0] if len(header) >= 20 else None
    return struct.unpack(">Q", header[16:24])[0] if len(header) >= 24 else None


def macho_kind(path: Path) -> str | None:
    try:
        with open(path, "rb") as handle:
            header = handle.read(32)
            offset = first_slice_offset(header)
            if offset is not None:
                handle.seek(offset)
                header = handle.read(32)
    except OSError:
        return None
    filetype = thin_filetype(header)
    if filetype is None:
        return None
    return "executable" if filetype == MH_EXECUTE else "library"


def signing_order(app: Path) -> list[tuple[Path, str]]:
    found = []
    for path in app.rglob("*"):
        if path.is_symlink() or not path.is_file():
            continue
        kind = macho_kind(path)
        if kind is not None:
            found.append((path, kind))
    return sorted(found, key=lambda item: (-len(item[0].parts), str(item[0])))


def symlinks_in(folder: Path) -> list[Path]:
    return sorted(path for path in folder.rglob("*") if path.is_symlink())


@dataclass(frozen=True)
class Signing:
    identity: str = AD_HOC
    keychain: str | None = None
    entitlements: Path | None = None

    @classmethod
    def from_environment(cls, entitlements: Path) -> Signing:
        identity = os.environ.get(IDENTITY_ENV, "").strip()
        if not identity:
            print(
                f"signing: {IDENTITY_ENV} is not set, so the app is signed ad hoc "
                "(it runs here, but Gatekeeper blocks it after a download)",
                flush=True,
            )
        keychain = os.environ.get(KEYCHAIN_ENV, "").strip() or None
        return cls(identity or AD_HOC, keychain, entitlements)

    @property
    def ad_hoc(self) -> bool:
        return self.identity == AD_HOC

    def command(self, path: Path, executable: bool) -> list[str]:
        command = [
            "codesign",
            "--force",
            "--sign",
            self.identity,
            "--options",
            "runtime",
        ]
        command.append("--timestamp=none" if self.ad_hoc else "--timestamp")
        if self.keychain:
            command += ["--keychain", self.keychain]
        if executable and self.entitlements is not None:
            command += ["--entitlements", str(self.entitlements)]
        return [*command, str(path)]

    def disk_image_command(self, path: Path) -> list[str]:
        command = ["codesign", "--force", "--sign", self.identity, "--timestamp"]
        if self.keychain:
            command += ["--keychain", self.keychain]
        return [*command, str(path)]


def write_entitlements(target: Path) -> Path:
    with open(target, "wb") as handle:
        plistlib.dump(ENTITLEMENTS, handle)
    return target


def sign_app(app: Path, signing: Signing) -> None:
    order = signing_order(app)
    print(f"signing: {len(order)} Mach-O files in {app.name}, inside out", flush=True)
    for path, kind in order:
        subprocess.run(
            signing.command(path, kind == "executable"),
            check=True,
            capture_output=True,
        )
    run(signing.command(app, True))
    verify(app)


def verify(app: Path) -> None:
    run(["codesign", "--verify", "--deep", "--strict", "--verbose=2", app])


def info_plist(version: str) -> dict[str, object]:
    return {
        "CFBundleDevelopmentRegion": "en",
        "CFBundleDisplayName": release_layout.APP_NAME,
        "CFBundleExecutable": release_layout.APP_NAME,
        "CFBundleIconFile": ICON_NAME,
        "CFBundleIdentifier": release_layout.BUNDLE_ID,
        "CFBundleInfoDictionaryVersion": "6.0",
        "CFBundleName": release_layout.APP_NAME,
        "CFBundlePackageType": "APPL",
        "CFBundleShortVersionString": version,
        "CFBundleVersion": version,
        "LSApplicationCategoryType": "public.app-category.photography",
        "LSMinimumSystemVersion": MINIMUM_MACOS,
        "LSUIElement": True,
        "NSHighResolutionCapable": True,
        "NSHumanReadableCopyright": "LibrePhotos contributors, MIT License",
        **USAGE_DESCRIPTIONS,
    }


def build_launcher(target: Path) -> Path:
    run(
        [
            "clang",
            "-O2",
            "-Wall",
            "-Werror",
            f"-mmacosx-version-min={MINIMUM_MACOS}",
            "-o",
            target,
            LAUNCHER_SOURCE,
        ]
    )
    return target


def build_icon(target: Path) -> Path | None:
    if not ICON_SOURCE.is_file():
        print(f"icon: {ICON_SOURCE} is missing; the app has no icon", flush=True)
        return None
    with tempfile.TemporaryDirectory() as scratch:
        iconset = Path(scratch) / "LibrePhotos.iconset"
        iconset.mkdir()
        for size in ICON_SIZES:
            for scale in (1, 2):
                name = f"icon_{size}x{size}{'@2x' if scale == 2 else ''}.png"
                pixels = str(size * scale)
                subprocess.run(
                    [
                        "sips",
                        "-z",
                        pixels,
                        pixels,
                        str(ICON_SOURCE),
                        "--out",
                        str(iconset / name),
                    ],
                    check=True,
                    capture_output=True,
                )
        run(["iconutil", "-c", "icns", iconset, "-o", target])
    return target


def assemble(dist: Path, output_dir: Path, version: str) -> Path:
    app = output_dir / release_layout.APP_BUNDLE
    shutil.rmtree(app, ignore_errors=True)
    layout = release_layout.MACOS_ARM64
    binary_folder = layout.binary_folder(app)
    binary_folder.parent.mkdir(parents=True)
    shutil.move(str(dist), str(binary_folder))
    links = symlinks_in(binary_folder)
    if links:
        sys.exit(
            f"the build has symbolic links, which the updater refuses: {links[:5]}"
        )
    launcher = layout.launcher(app)
    launcher.parent.mkdir(parents=True)
    build_launcher(launcher)
    contents = app / "Contents"
    with open(contents / "Info.plist", "wb") as handle:
        plistlib.dump(info_plist(version), handle)
    (contents / "PkgInfo").write_text("APPL????", encoding="ascii")
    build_icon(contents / "Resources" / ICON_NAME)
    uninstall = contents / "Resources" / UNINSTALL_SCRIPT.name
    shutil.copy(UNINSTALL_SCRIPT, uninstall)
    uninstall.chmod(0o755)
    return app


def stamp(app: Path, version: str) -> None:
    layout = release_layout.MACOS_ARM64
    info_path = layout.build_info(app)
    info = json.loads(info_path.read_text(encoding="utf-8"))
    info["version"] = version
    info_path.write_text(json.dumps(info), encoding="utf-8")
    plist_path = app / "Contents" / "Info.plist"
    with open(plist_path, "rb") as handle:
        plist = plistlib.load(handle)
    plist["CFBundleShortVersionString"] = version
    plist["CFBundleVersion"] = version
    with open(plist_path, "wb") as handle:
        plistlib.dump(plist, handle)


def zip_app(app: Path, target: Path) -> Path:
    target.unlink(missing_ok=True)
    made = shutil.make_archive(
        str(target.with_suffix("")), "zip", root_dir=app.parent, base_dir=app.name
    )
    return Path(made)


def hdiutil(arguments: Sequence[str | Path]) -> None:
    for attempt in range(HDIUTIL_ATTEMPTS):
        try:
            run(["hdiutil", *arguments])
            return
        except subprocess.CalledProcessError:
            if attempt == HDIUTIL_ATTEMPTS - 1:
                raise
            time.sleep(5)


def make_dmg(app: Path, target: Path, signing: Signing) -> Path:
    target.unlink(missing_ok=True)
    with tempfile.TemporaryDirectory() as scratch:
        staging = Path(scratch) / "dmg"
        staging.mkdir()
        run(["ditto", app, staging / app.name])
        (staging / "Applications").symlink_to("/Applications")
        hdiutil(
            [
                "create",
                "-volname",
                VOLUME_NAME,
                "-srcfolder",
                staging,
                "-fs",
                "HFS+",
                "-format",
                "UDZO",
                "-ov",
                target,
            ]
        )
    if not signing.ad_hoc:
        run(signing.disk_image_command(target))
    return target


@dataclass(frozen=True)
class Notary:
    key: str
    key_id: str
    issuer: str

    @classmethod
    def from_environment(cls) -> Notary | None:
        values = [
            os.environ.get(NOTARY_KEY_ENV, "").strip(),
            os.environ.get(NOTARY_KEY_ID_ENV, "").strip(),
            os.environ.get(NOTARY_ISSUER_ENV, "").strip(),
        ]
        if not all(values):
            print(
                "notarization: skipped ("
                f"{NOTARY_KEY_ENV}, {NOTARY_KEY_ID_ENV} and {NOTARY_ISSUER_ENV} are not all set)",
                flush=True,
            )
            return None
        return cls(*values)

    def submit(self, path: Path) -> None:
        run(
            [
                "xcrun",
                "notarytool",
                "submit",
                path,
                "--key",
                self.key,
                "--key-id",
                self.key_id,
                "--issuer",
                self.issuer,
                "--wait",
                "--timeout",
                "2h",
            ]
        )


def staple(path: Path) -> None:
    run(["xcrun", "stapler", "staple", path])
    run(["xcrun", "stapler", "validate", path])


def notarize_app(app: Path, notary: Notary) -> None:
    with tempfile.TemporaryDirectory() as scratch:
        upload = Path(scratch) / f"{app.stem}.zip"
        run(["ditto", "-c", "-k", "--keepParent", app, upload])
        notary.submit(upload)
    staple(app)


def dmg_names(version: str, suffix: str) -> list[str]:
    stable = f"{DMG_PREFIX}-{suffix}.dmg"
    if version == "0.0.0":
        return [stable]
    return [f"{DMG_PREFIX}-{version}-{suffix}.dmg", stable]


def package(
    dist: Path, output_dir: Path, version: str, zip_names: Sequence[str], suffix: str
) -> list[Path]:
    app = assemble(dist, output_dir, version)
    signing = Signing.from_environment(
        write_entitlements(output_dir / "entitlements.plist")
    )
    sign_app(app, signing)
    notary = Notary.from_environment() if not signing.ad_hoc else None
    if notary is not None:
        notarize_app(app, notary)
    first_zip, *zip_aliases = zip_names
    zips = [zip_app(app, output_dir / f"{first_zip}.zip")]
    zips += [
        Path(shutil.copyfile(zips[0], output_dir / f"{alias}.zip"))
        for alias in zip_aliases
    ]
    first_dmg, *dmg_aliases = dmg_names(version, suffix)
    dmg = make_dmg(app, output_dir / first_dmg, signing)
    if notary is not None:
        notary.submit(dmg)
        staple(dmg)
    dmgs = [dmg] + [
        Path(shutil.copyfile(dmg, output_dir / alias)) for alias in dmg_aliases
    ]
    return [*zips, *dmgs]


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sign, stamp and pack the Mac app")
    sub = parser.add_subparsers(dest="command", required=True)
    sign = sub.add_parser("sign", help="sign every Mach-O file and the app")
    sign.add_argument("app", type=Path)
    stamp_parser = sub.add_parser("stamp", help="set the version the app reports")
    stamp_parser.add_argument("app", type=Path)
    stamp_parser.add_argument("version")
    dmg = sub.add_parser("dmg", help="a disk image with the app")
    dmg.add_argument("app", type=Path)
    dmg.add_argument("target", type=Path)
    zip_parser = sub.add_parser("zip", help="the zip the updater downloads")
    zip_parser.add_argument("app", type=Path)
    zip_parser.add_argument("target", type=Path)
    args = parser.parse_args(argv)
    if args.command == "stamp":
        stamp(args.app, args.version)
        return 0
    entitlements = write_entitlements(Path(tempfile.mkdtemp()) / "entitlements.plist")
    signing = Signing.from_environment(entitlements)
    if args.command == "sign":
        sign_app(args.app, signing)
    elif args.command == "dmg":
        make_dmg(args.app, args.target, signing)
    else:
        zip_app(args.app, args.target)
    return 0


if __name__ == "__main__":
    sys.exit(main())
