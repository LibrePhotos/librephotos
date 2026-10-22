"""Grabbing single frames of a video as still pictures (#2761).

Scan Faces reads a few frames across a video, not only the first one the big
thumbnail shows. Each frame is grabbed the way the big thumbnail is
(``api.thumbnails.render.create_thumbnail_for_video``): at the video's own
size, turned the way the player shows it, tonemapped when the video is HDR.
So a face box in a frame is in the same pixels as one in the big thumbnail.
"""

from __future__ import annotations

import os

from api.runtime import binaries
from api.video import color

# Seeking to a frame and writing it is under a second for a phone video; a
# 4K HEVC frame on a slow ARM box a few. ffmpeg still running after this is
# stuck on the file.
FRAME_TIMEOUT = 60


class FrameError(RuntimeError):
    """ffmpeg could not write the frame (a broken file, a time past its end)."""


def frame_args(
    input_path: str, seconds: float, output_path: str, transfer: str | None
) -> list[str]:
    """The ffmpeg arguments that write the frame at ``seconds`` to ``output_path``.

    ``-ss`` before ``-i`` seeks the input to the keyframe before the time and
    decodes from there, which is fast and still exact. No metadata is copied:
    the frame is read by the face service and deleted.
    """
    args = [
        "-y",
        "-ss",
        f"{seconds:.3f}",
        "-i",
        input_path,
        "-frames:v",
        "1",
        "-q:v",
        "2",
        "-map_metadata",
        "-1",
    ]
    tonemap = color.video_filter(input_path, transfer=transfer)
    if tonemap:
        args += ["-filter:v", tonemap]
    args.append(output_path)
    return args


def grab_frame(
    input_path: str, seconds: float, output_path: str, transfer: str | None = None
) -> None:
    """Write the frame of ``input_path`` at ``seconds`` to ``output_path`` (a JPEG).

    ``transfer`` is the video's stored colour transfer (``None`` probes the
    file). Raises ``FrameError`` when ffmpeg fails, is missing or hangs.
    """
    try:
        binaries.run_tool(
            "ffmpeg",
            frame_args(input_path, seconds, output_path, transfer),
            timeout=FRAME_TIMEOUT,
        )
    except binaries.ToolError as error:
        raise FrameError(str(error)) from error
    # Past the last frame ffmpeg writes nothing and still exits 0.
    if not os.path.exists(output_path):
        raise FrameError(f"no frame at {seconds:.3f} s")
