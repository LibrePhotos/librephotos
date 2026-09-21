"""Wrap ExifTool in wheels so pip installs it: the official .exe for Windows and the
Perl distribution for everything else (needs a perl on PATH).

    python scripts/build_exiftool_wheel.py 13.57 [out_dir]

writes exiftool_bin-<ver>-py3-none-win_amd64.whl and exiftool_bin-<ver>-py3-none-any.whl.
The package puts its folder on PATH when imported, and a .pth imports it at
interpreter start, so `exiftool` is found by PyExifTool and any subprocess.
"""

import base64
import hashlib
import io
import sys
import tarfile
import urllib.request
import zipfile
from pathlib import Path

INIT = """import os
from pathlib import Path

os.environ["PATH"] = str(Path(__file__).parent) + os.pathsep + os.environ.get("PATH", "")
"""


def download(name):
    for url in (
        f"https://sourceforge.net/projects/exiftool/files/{name}/download",
        f"https://exiftool.org/{name}",
    ):
        try:
            return urllib.request.urlopen(url, timeout=120).read()
        except Exception as error:  # noqa: BLE001
            print(f"{url}: {error}")
    sys.exit(f"could not download {name}")


def windows_files(version):
    src = zipfile.ZipFile(io.BytesIO(download(f"exiftool-{version}_64.zip")))
    root = f"exiftool-{version}_64/"
    for info in src.infolist():
        if info.is_dir() or not info.filename.startswith(root):
            continue
        rel = info.filename[len(root) :]
        if rel == "exiftool(-k).exe":
            yield "exiftool.exe", src.read(info), 0o644
        elif rel.startswith("exiftool_files/"):
            yield rel, src.read(info), 0o644


def perl_files(version):
    src = tarfile.open(fileobj=io.BytesIO(download(f"Image-ExifTool-{version}.tar.gz")))
    root = f"Image-ExifTool-{version}/"
    for member in src.getmembers():
        if not member.isfile() or not member.name.startswith(root):
            continue
        rel = member.name[len(root) :]
        if rel == "exiftool":
            yield rel, src.extractfile(member).read(), 0o755
        elif rel.startswith("lib/"):
            yield rel, src.extractfile(member).read(), 0o644


def build(version, out_dir, tag, payload):
    files = {
        "exiftool_bin/__init__.py": (INIT.encode(), 0o644),
        "exiftool_bin.pth": (b"import exiftool_bin\n", 0o644),
    }
    for rel, data, mode in payload:
        files["exiftool_bin/" + rel] = (data, mode)
    dist = f"exiftool_bin-{version}.dist-info/"
    files[dist + "METADATA"] = (
        (
            f"Metadata-Version: 2.1\nName: exiftool-bin\nVersion: {version}\n"
            "Summary: ExifTool packaged for pip\nLicense: GPL-1.0-or-later OR Artistic-1.0-Perl\n"
        ).encode(),
        0o644,
    )
    files[dist + "WHEEL"] = (
        f"Wheel-Version: 1.0\nGenerator: build_exiftool_wheel\nRoot-Is-Purelib: true\nTag: {tag}\n".encode(),
        0o644,
    )
    record = []
    out = Path(out_dir) / f"exiftool_bin-{version}-{tag}.whl"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as whl:
        for name, (data, mode) in files.items():
            info = zipfile.ZipInfo(name, date_time=(2000, 1, 1, 0, 0, 0))
            info.create_system = 3  # unix, so the mode bits count
            info.external_attr = (0o100000 | mode) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            whl.writestr(info, data)
            digest = base64.urlsafe_b64encode(hashlib.sha256(data).digest()).rstrip(
                b"="
            )
            record.append(f"{name},sha256={digest.decode()},{len(data)}")
        record.append(dist + "RECORD,,")
        whl.writestr(dist + "RECORD", "\n".join(record) + "\n")
    print(out, out.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    version = sys.argv[1]
    out_dir = sys.argv[2] if len(sys.argv) > 2 else "."
    build(version, out_dir, "py3-none-win_amd64", windows_files(version))
    build(version, out_dir, "py3-none-any", perl_files(version))
