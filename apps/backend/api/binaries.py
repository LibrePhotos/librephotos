"""Absolute paths of the external tools, resolved through PATH.

The ffmpeg-bin and exiftool-bin wheels prepend their folders to PATH at interpreter
start. Windows' CreateProcess searches System32 before PATH, so a bare "ffmpeg"
can still pick up a stray copy there; resolving with shutil.which honours PATH order.
"""

import shutil


def resolve(name: str) -> str:
    return shutil.which(name) or name


def ffmpeg() -> str:
    return resolve("ffmpeg")


def ffprobe() -> str:
    return resolve("ffprobe")


def exiftool() -> str:
    return resolve("exiftool")
