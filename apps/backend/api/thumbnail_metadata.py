"""Strip the original's metadata from thumbnails written before it was dropped.

Thumbnails used to carry the photo's EXIF and XMP (GPS position, camera serial
number, keywords) and a video's recorded location, because libvips and ffmpeg
copy metadata into what they write. New thumbnails are written without it (see
``api.thumbnails.WEBP``); this cleans the ones already on disk in place. Only
the container changes, never the encoded picture, so pixels and perceptual
hashes stay the same. The ICC profile is kept.

WebP metadata lives in its own RIFF chunks, so those are dropped here directly,
without starting ExifTool for every batch of a library's worth of thumbnails.
Video thumbnails go through ExifTool. Only files that still carry metadata are
rewritten, so a second run just reads.
"""

import json
import os
import stat
import subprocess
import tempfile
from dataclasses import dataclass, field

from django.conf import settings

from api import binaries

THUMBNAIL_DIRS = ("thumbnails_big", "square_thumbnails", "square_thumbnails_small")

METADATA_CHUNKS = (b"EXIF", b"XMP ")
# The VP8X header announces the metadata chunks with these flag bits.
VP8X_EXIF_FLAG = 0x08
VP8X_XMP_FLAG = 0x04

# ExifTool is started once per batch; the paths go through an argument file.
BATCH_SIZE = 500
# What a video thumbnail can carry from its source, by ExifTool group. ffmpeg
# itself writes ItemList:Encoder into every file it makes, which is harmless.
MP4_METADATA_GROUPS = ["-UserData:all", "-ItemList:all", "-Keys:all", "-XMP:all"]
HARMLESS_MP4_TAGS = {"SourceFile", "ItemList:Encoder"}


@dataclass
class StripResult:
    scanned: int = 0
    with_metadata: list = field(default_factory=list)
    stripped: int = 0
    still_with_metadata: list = field(default_factory=list)
    errors: list = field(default_factory=list)


def _webp_chunks(data):
    """The RIFF chunks of a WebP file as (fourcc, bytes) pairs, or None if it is not one."""
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return None
    end = min(len(data), 8 + int.from_bytes(data[4:8], "little"))
    chunks = []
    position = 12
    while position + 8 <= end:
        size = int.from_bytes(data[position + 4 : position + 8], "little")
        chunk_end = position + 8 + size + (size & 1)
        chunks.append((data[position : position + 4], data[position:chunk_end]))
        position = chunk_end
    return chunks


def webp_has_metadata(path):
    """Whether the WebP at ``path`` has an EXIF or XMP chunk."""
    with open(path, "rb") as handle:
        chunks = _webp_chunks(handle.read())
    return any(fourcc in METADATA_CHUNKS for fourcc, _ in chunks or ())


def strip_webp_metadata(path):
    """Drop the EXIF and XMP chunks of the WebP at ``path``; return whether it changed.

    The file is replaced atomically, so a reader never sees half of it.
    """
    with open(path, "rb") as handle:
        chunks = _webp_chunks(handle.read())
    if not chunks or not any(fourcc in METADATA_CHUNKS for fourcc, _ in chunks):
        return False
    kept = []
    for fourcc, chunk in chunks:
        if fourcc in METADATA_CHUNKS:
            continue
        if fourcc == b"VP8X":
            chunk = bytearray(chunk)
            chunk[8] &= ~(VP8X_EXIF_FLAG | VP8X_XMP_FLAG) & 0xFF
        kept.append(bytes(chunk))
    body = b"WEBP" + b"".join(kept)
    original = os.stat(path)
    handle, temporary = tempfile.mkstemp(dir=os.path.dirname(path), suffix=".tmp")
    try:
        with os.fdopen(handle, "wb") as out:
            out.write(b"RIFF" + len(body).to_bytes(4, "little") + body)
        # mkstemp makes the file private to this user; the proxy serving
        # protected_media may run as another one.
        os.chmod(temporary, stat.S_IMODE(original.st_mode))
        if hasattr(os, "chown") and os.geteuid() == 0:
            os.chown(temporary, original.st_uid, original.st_gid)
        os.replace(temporary, path)
    except BaseException:
        os.remove(temporary)
        raise
    return True


def _exiftool(arguments, paths):
    """Run ExifTool on ``paths`` (passed in an argument file); return the process."""
    with tempfile.NamedTemporaryFile(
        "w", suffix=".args", delete=False, encoding="utf-8"
    ) as argfile:
        argfile.write("\n".join(paths) + "\n")
    try:
        return subprocess.run(
            [binaries.exiftool(), "-charset", "filename=utf8", *arguments]
            + ["-@", argfile.name],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    finally:
        os.remove(argfile.name)


def _batches(paths):
    for start in range(0, len(paths), BATCH_SIZE):
        yield paths[start : start + BATCH_SIZE]


def mp4s_with_metadata(paths):
    """The video thumbnails in ``paths`` that carry metadata from their source."""
    found = []
    for batch in _batches(paths):
        result = _exiftool(["-j", "-G1", "-a", *MP4_METADATA_GROUPS], batch)
        for entry in json.loads(result.stdout or "[]"):
            # ExifTool:Error / Warning describe the file, they are not in it.
            tags = {tag for tag in entry if not tag.startswith("ExifTool:")}
            if tags - HARMLESS_MP4_TAGS:
                found.append(os.path.normpath(entry["SourceFile"]))
    return found


def _strip_mp4s(paths, errors):
    for batch in _batches(paths):
        process = _exiftool(["-overwrite_original", "-q", "-q", "-all="], batch)
        if process.returncode != 0:
            errors.append(
                process.stderr.strip() or f"exiftool exit {process.returncode}"
            )


def _thumbnail_files(media_root):
    webps, mp4s = [], []
    for directory in THUMBNAIL_DIRS:
        folder = os.path.join(media_root, directory)
        if not os.path.isdir(folder):
            continue
        for entry in os.scandir(folder):
            if not entry.is_file():
                continue
            extension = os.path.splitext(entry.name)[1].lower()
            if extension == ".webp":
                webps.append(entry.path)
            elif extension == ".mp4":
                mp4s.append(entry.path)
    return webps, mp4s


def _webps(paths, action, errors, progress):
    """The ``paths`` for which ``action`` returned true; failures go to ``errors``."""
    found = []
    for index, path in enumerate(paths, 1):
        try:
            if action(path):
                found.append(path)
        except OSError as error:
            errors.append(f"{path}: {error}")
        if progress and index % 10000 == 0:
            progress(f"{index}/{len(paths)} WebP thumbnails done")
    return found


def strip_thumbnail_metadata(media_root=None, dry_run=False, progress=None):
    """Remove EXIF, XMP and video metadata from every thumbnail under ``media_root``."""
    media_root = media_root or settings.MEDIA_ROOT
    result = StripResult()
    webps, mp4s = _thumbnail_files(media_root)
    result.scanned = len(webps) + len(mp4s)
    dirty_mp4s = mp4s_with_metadata(mp4s) if mp4s else []

    if dry_run:
        dirty_webps = _webps(webps, webp_has_metadata, result.errors, progress)
        result.with_metadata = dirty_webps + dirty_mp4s
        return result

    stripped_webps = _webps(webps, strip_webp_metadata, result.errors, progress)
    _strip_mp4s(dirty_mp4s, result.errors)
    result.with_metadata = stripped_webps + dirty_mp4s
    # Counted from what is on disk afterwards, not from what the tools report.
    left = _webps(stripped_webps, webp_has_metadata, result.errors, None)
    left += mp4s_with_metadata(dirty_mp4s) if dirty_mp4s else []
    result.still_with_metadata = left
    result.stripped = len(result.with_metadata) - len(left)
    return result
