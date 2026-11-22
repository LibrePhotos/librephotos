import argparse
import hashlib
import json
import shutil
import subprocess
import tarfile
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
SOURCES_FILE = HERE / "sources.json"
BUILD_FILES = [
    HERE / "build.sh",
    HERE / "sources.json",
    HERE / "sources.py",
    HERE / "compat.py",
    HERE / "requirements.build.txt",
    HERE.parent / "build_ffmpeg_wheel.py",
]
FIXED_MTIME = 946684800


def load_sources() -> dict[str, dict]:
    return json.loads(SOURCES_FILE.read_text(encoding="utf-8"))


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def archive_name(name: str, source: dict) -> str:
    if "url" in source:
        return source["url"].rsplit("/", 1)[1]
    return f"{name}-{source['commit'][:12]}.tar.xz"


def download(url: str, target: Path, sha256: str) -> None:
    if not target.exists() or sha256_of(target) != sha256:
        print("downloading", url, flush=True)
        part = target.with_suffix(target.suffix + ".part")
        with (
            urllib.request.urlopen(url, timeout=600) as response,
            part.open("wb") as out,
        ):
            shutil.copyfileobj(response, out)
        part.replace(target)
    actual = sha256_of(target)
    if actual != sha256:
        raise SystemExit(f"{target.name}: sha256 {actual}, expected {sha256}")


def extract(archive: Path, target: Path) -> None:
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True)
    with tarfile.open(archive) as tar:
        for member in tar.getmembers():
            parts = Path(member.name).parts[1:]
            if not parts:
                continue
            member.name = str(Path(*parts))
            tar.extract(member, target, filter="tar")


def git_checkout(source: dict, target: Path) -> None:
    if target.exists():
        shutil.rmtree(target)
    subprocess.run(["git", "clone", "--quiet", source["git"], str(target)], check=True)
    subprocess.run(
        ["git", "-C", str(target), "checkout", "--quiet", source["commit"]], check=True
    )
    if source.get("submodules"):
        subprocess.run(
            [
                "git",
                "-C",
                str(target),
                "submodule",
                "update",
                "--init",
                "--recursive",
                "--quiet",
            ],
            check=True,
        )
    head = subprocess.run(
        ["git", "-C", str(target), "rev-parse", "HEAD"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()
    if head != source["commit"]:
        raise SystemExit(f"{target.name}: HEAD {head}, expected {source['commit']}")


def reset_tarinfo(info: tarfile.TarInfo) -> tarfile.TarInfo:
    info.mtime = FIXED_MTIME
    info.uid = info.gid = 0
    info.uname = info.gname = ""
    return info


def write_tree_archive(
    root: Path, prefix: str, target: Path, exclude: set[str]
) -> None:
    files = sorted(
        path
        for path in root.rglob("*")
        if not exclude.intersection(path.relative_to(root).parts)
    )
    with tarfile.open(target, "w:xz") as tar:
        for path in files:
            if path.is_dir() and not path.is_symlink():
                continue
            tar.add(
                path,
                f"{prefix}/{path.relative_to(root).as_posix()}",
                recursive=False,
                filter=reset_tarinfo,
            )


def fetch(src: Path, archives: Path) -> None:
    src.mkdir(parents=True, exist_ok=True)
    archives.mkdir(parents=True, exist_ok=True)
    for name, source in load_sources().items():
        if "url" in source:
            archive = archives / archive_name(name, source)
            download(source["url"], archive, source["sha256"])
            extract(archive, src / name)
        else:
            git_checkout(source, src / name)
            write_tree_archive(
                src / name,
                f"{name}-{source['commit'][:12]}",
                archives / archive_name(name, source),
                {".git"},
            )


def bundle(archives: Path, out: Path, version: str) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for name, source in load_sources().items():
        shutil.copy2(
            archives / archive_name(name, source), out / archive_name(name, source)
        )
    scripts = out / f"ffmpeg-bin-{version}-build-scripts.tar.xz"
    with tarfile.open(scripts, "w:xz") as tar:
        for path in BUILD_FILES:
            tar.add(
                path,
                f"ffmpeg-bin-{version}-build-scripts/{path.name}",
                filter=reset_tarinfo,
            )
    sums = [
        f"{sha256_of(path)}  {path.name}"
        for path in sorted(out.iterdir())
        if path.name != "SHA256SUMS"
    ]
    (out / "SHA256SUMS").write_text("\n".join(sums) + "\n", encoding="utf-8")


def notices(
    src: Path, stage: Path, source_url: str, configure: str, toolchain: str
) -> None:
    sources = load_sources()
    licenses = stage / "licenses"
    licenses.mkdir(parents=True, exist_ok=True)
    lines = []
    for name, source in sources.items():
        if not source["linked"]:
            continue
        for license_file in source["license_files"]:
            target = licenses / name / license_file
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(src / name / license_file, target)
        lines.append(f"  {name} {source['version']} ({source['license']})")
    ffmpeg = sources["ffmpeg"]
    header = [
        f"ffmpeg and ffprobe {ffmpeg['version']}, built for LibrePhotos.",
        "",
        "FFmpeg is configured with --enable-gpl and links x264, so this build as a whole",
        "is licensed under the GNU General Public License, version 2 or later. The full",
        "text follows below; licenses/ holds the license of every component:",
        "",
        *lines,
        "",
        "The corresponding source code of every component, the build scripts and the",
        "configure line are published next to these binaries:",
        f"  {source_url}",
        "",
        "-" * 78,
        "",
    ]
    gpl = (src / "ffmpeg" / "COPYING.GPLv2").read_text(encoding="utf-8")
    (stage / "LICENSE.txt").write_text("\n".join(header) + gpl, encoding="utf-8")
    build = [
        f"source: {source_url}",
        f"toolchain: {toolchain}",
        "components:",
        *(
            f"  {name} {source['version']} {source.get('sha256') or source.get('commit')}"
            for name, source in sources.items()
        ),
        "ffmpeg configure:",
        f"  {configure}",
        "",
    ]
    (stage / "BUILD.txt").write_text("\n".join(build), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest="command", required=True)
    fetch_parser = commands.add_parser("fetch")
    fetch_parser.add_argument("src", type=Path)
    fetch_parser.add_argument("archives", type=Path)
    bundle_parser = commands.add_parser("bundle")
    bundle_parser.add_argument("archives", type=Path)
    bundle_parser.add_argument("out", type=Path)
    notices_parser = commands.add_parser("notices")
    notices_parser.add_argument("src", type=Path)
    notices_parser.add_argument("stage", type=Path)
    notices_parser.add_argument("source_url")
    notices_parser.add_argument("configure")
    notices_parser.add_argument("toolchain")
    commands.add_parser("version")
    args = parser.parse_args()
    if args.command == "fetch":
        fetch(args.src, args.archives)
    elif args.command == "bundle":
        bundle(args.archives, args.out, load_sources()["ffmpeg"]["version"])
    elif args.command == "notices":
        notices(args.src, args.stage, args.source_url, args.configure, args.toolchain)
    else:
        print(load_sources()["ffmpeg"]["version"])


if __name__ == "__main__":
    main()
