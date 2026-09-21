"""Absolute paths of the external tools, resolved through PATH.

The ffmpeg-bin and exiftool-bin wheels prepend their folders to PATH at interpreter
start. Windows' CreateProcess searches System32 before PATH, so a bare "ffmpeg"
can still pick up a stray copy there; resolving with shutil.which honours PATH order.
"""

import shutil


def resolve(name):
    return shutil.which(name) or name


def ffmpeg():
    return resolve("ffmpeg")


def ffprobe():
    return resolve("ffprobe")


def exiftool():
    return resolve("exiftool")
