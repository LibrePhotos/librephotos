"""Telling the browser what a video is, so that it can say whether it plays it.

Which videos a browser decodes is not something the server can know. HEVC is
the common case: Safari plays it, Chrome and Edge play it where the machine has
a hardware decoder, Firefox mostly does not. Deciding on the server would mean
either converting an HEVC clip for a browser that plays it -- the conversion is
capped at 720 lines, so a 4K iPhone video would play at a fraction of its
resolution -- or leaving it unconverted for one that does not, where Chrome
plays the sound over a black picture and reports no error at all.

The browser can say, through ``canPlayType``, if it is told what the file is in
the form it expects: a container MIME type and an RFC 6381 codec string. That
is what :func:`playback_type` builds from what the scan stored (see
:mod:`api.video_color`), and the frontend asks for a conversion only when the
answer is no.

The codec strings name a profile and a level. The profile follows from the
pixel format -- it is what separates the 10-bit HEVC every recent phone records
from the 8-bit kind, and H.264 High 10 from the High profile everything plays.
The level is a representative one; ``canPlayType`` decides on the profile.
"""

import re

# Where the chroma and the bit depth sit in an ffmpeg pixel format name:
# yuv420p, yuvj420p, yuv420p10le, p010le, nv12, yuv422p10le, yuv444p12le.
_CHROMA = re.compile(r"(420|422|444)")
_HIGH_DEPTH = re.compile(r"(p1[02](le|be)$|^p01[06])")

_CODEC_STRINGS = {
    # (8-bit 4:2:0, 10-bit 4:2:0, 4:2:2, 4:4:4)
    "h264": ("avc1.640028", "avc1.6E0028", "avc1.7A0028", "avc1.F40028"),
    "hevc": (
        "hvc1.1.6.L120.90",
        "hvc1.2.4.L120.90",
        "hvc1.4.10.L120.90",
        "hvc1.4.10.L120.90",
    ),
    "vp9": ("vp09.00.40.08", "vp09.02.40.10", "vp09.01.40.08", "vp09.01.40.08"),
    "av1": ("av01.0.08M.08", "av01.0.08M.10", "av01.2.08M.10", "av01.1.08M.08"),
}

# Codecs whose string does not depend on the pixel format.
_FIXED_CODEC_STRINGS = {
    "vp8": "vp8",
    # MPEG-4 Part 2, from older phones and compact cameras.
    "mpeg4": "mp4v.20.9",
}

_WEBM_CODECS = {"vp8", "vp9", "av1"}


def _format_class(pixel_format):
    """Which column of ``_CODEC_STRINGS`` a pixel format belongs to."""
    chroma = _CHROMA.search(pixel_format or "")
    if chroma and chroma.group(1) == "422":
        return 2
    if chroma and chroma.group(1) == "444":
        return 3
    return 1 if _HIGH_DEPTH.search(pixel_format or "") else 0


def _mime_type(container, codec):
    """The MIME type ``canPlayType`` should hear for this container."""
    families = (container or "").split(",")
    if "mp4" in families or "mov" in families:
        return "video/mp4"
    if "webm" in families or "matroska" in families:
        # ffprobe cannot tell the two apart. A WebM is a Matroska file holding
        # only WebM codecs, and browsers that do not play Matroska as such play
        # those.
        return "video/webm" if codec in _WEBM_CODECS else "video/x-matroska"
    if "mpegts" in families:
        return "video/mp2t"
    return f"video/{families[0]}" if families[0] else "video/mp4"


def playback_type(photo):
    """The ``canPlayType`` argument for ``photo``, or ``None`` when unknown.

    ``None`` for anything that is not a probed video. An unknown codec is still
    named, as ffprobe calls it: no browser recognises ``prores`` or
    ``mpeg2video``, so the answer comes back as no and the video is converted,
    which is right.
    """
    if not getattr(photo, "video", False):
        return None
    codec = getattr(photo, "video_codec", None)
    if not codec:
        return None
    if codec in _CODEC_STRINGS:
        codec_string = _CODEC_STRINGS[codec][_format_class(photo.video_pixel_format)]
    else:
        codec_string = _FIXED_CODEC_STRINGS.get(codec, codec)
    return f'{_mime_type(photo.video_container, codec)}; codecs="{codec_string}"'
