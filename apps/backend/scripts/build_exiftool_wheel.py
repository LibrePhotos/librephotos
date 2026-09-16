"""Wrap the official ExifTool Windows build in a wheel: exiftool_bin-<ver>-py3-none-win_amd64.whl.

    python scripts/build_exiftool_wheel.py 13.57 [out_dir]

The package puts its folder on PATH when imported, and a .pth file imports it at
interpreter start, so `exiftool` is found by PyExifTool and any subprocess.
"""

import base64
import hashlib
import io
import sys
import urllib.request
import zipfile
from pathlib import Path

INIT = """import os
from pathlib import Path

EXECUTABLE = str(Path(__file__).parent / "exiftool.exe")
os.environ["PATH"] = str(Path(__file__).parent) + os.pathsep + os.environ.get("PATH", "")
"""


def download(version):
    name = f"exiftool-{version}_64.zip"
    for url in (
        f"https://sourceforge.net/projects/exiftool/files/{name}/download",
        f"https://exiftool.org/{name}",
    ):
        try:
            return urllib.request.urlopen(url, timeout=120).read()
        except Exception as error:  # noqa: BLE001
            print(f"{url}: {error}")
    sys.exit("could not download exiftool")


def build(version, out_dir):
    src = zipfile.ZipFile(io.BytesIO(download(version)))
    root = f"exiftool-{version}_64/"
    files = {
        "exiftool_bin/__init__.py": INIT.encode(),
        "exiftool_bin.pth": b"import exiftool_bin\n",
    }
    for info in src.infolist():
        if info.is_dir() or not info.filename.startswith(root):
            continue
        rel = info.filename[len(root) :]
        if rel == "exiftool(-k).exe":
            rel = "exiftool.exe"
        elif not rel.startswith("exiftool_files/"):
            continue
        files["exiftool_bin/" + rel] = src.read(info)
    dist = f"exiftool_bin-{version}.dist-info/"
    files[dist + "METADATA"] = (
        f"Metadata-Version: 2.1\nName: exiftool-bin\nVersion: {version}\n"
        "Summary: ExifTool for Windows, packaged for pip\nLicense: GPL-1.0-or-later OR Artistic-1.0-Perl\n"
    ).encode()
    files[dist + "WHEEL"] = (
        b"Wheel-Version: 1.0\nGenerator: build_exiftool_wheel\nRoot-Is-Purelib: true\nTag: py3-none-win_amd64\n"
    )
    record = []
    out = Path(out_dir) / f"exiftool_bin-{version}-py3-none-win_amd64.whl"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as whl:
        for name, data in files.items():
            whl.writestr(name, data)
            digest = (
                base64.urlsafe_b64encode(hashlib.sha256(data).digest())
                .rstrip(b"=")
                .decode()
            )
            record.append(f"{name},sha256={digest},{len(data)}")
        record.append(dist + "RECORD,,")
        whl.writestr(dist + "RECORD", "\n".join(record) + "\n")
    print(out, out.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    build(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else ".")
