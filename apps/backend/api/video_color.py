"""Making an HDR source look like itself once it has been converted to SDR.

Phones have recorded HDR by default for years -- iPhone 12 onwards in Dolby
Vision, most Android flagships in HLG -- and everything this codebase does to a
video (live playback conversion, the cached copy, the animated thumbnail) ends
in libx264 with no colour handling at all. The samples come out carrying a PQ or
HLG transfer curve and the tags that said so are dropped on the way, so the
browser decodes them as plain bt709. A curve designed for ten thousand nits read
as if it were a hundred is the washed-out, low-contrast picture reported in
 #455: greys where the blacks were, and no saturation anywhere.

Converting properly means leaving the source's curve for a linear light signal,
mapping the much larger dynamic range down to what SDR can hold, and re-encoding
to bt709. That is what the filter chain below does, and it is not free -- the
float pipeline roughly doubles the filtering cost -- so it is applied only to
the sources that actually are HDR rather than to everything.

The chain needs zscale, which is libzimg, which is a build option. Debian and
Ubuntu build their ffmpeg with it and so do the images in ``deploy/docker``, but
a host supplying its own ffmpeg can be anything at all, and an unavailable
filter is a hard failure -- ffmpeg exits, which would turn every HDR video into
a broken one rather than a washed-out one. So it is probed, and without it the
source is at least still flattened to 8-bit; see ``_FALLBACK``.
"""

import json
import logging
import shutil
import subprocess

from api import binaries

from api import ffmpeg_budget

logger = logging.getLogger(__name__)

# What ffprobe calls the two transfer curves that need tonemapping: PQ, used by
# HDR10 and Dolby Vision, and HLG, used by most Android phones. Everything else
# it reports -- bt709, smpte170m, an empty string for a file that does not say
# -- is already SDR and has to be left alone.
HDR_TRANSFERS = frozenset({"smpte2084", "arib-std-b67"})

# npl=100 is the display being mapped *to*, not the one the source was graded
# for: 100 nits is SDR reference white. hable rolls the highlights off gradually
# instead of clipping them, which is what stops a bright sky becoming a flat
# white shape.
_TONEMAP = (
    "zscale=t=linear:npl=100,"
    "format=gbrpf32le,"
    "zscale=p=bt709,"
    "tonemap=hable,"
    "zscale=t=bt709:m=bt709:r=tv,"
    "format=yuv420p"
)

# Without zscale the colours cannot be fixed, but the bit depth still can be. An
# HDR source is 10-bit, and libx264 handed 10-bit samples encodes High 10, which
# no browser decodes -- so the untonemapped fallback is at least a video that
# plays, washed out, rather than one that does not play at all.
_FALLBACK = "format=yuv420p"


def transfer_characteristics(path):
    """The transfer curve ffprobe reports for ``path``'s first video stream.

    An empty string whenever the answer cannot be had: no ffprobe on the host,
    an unreadable or non-video file, a stream that simply does not say. Callers
    read that as "not HDR", which is the behaviour that was there before, so a
    failure here leaves the video converted exactly as it always was.
    """
    if not shutil.which("ffprobe"):
        return ""
    try:
        output = subprocess.run(
            [
                binaries.ffprobe(),
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=color_transfer",
                "-of",
                "json",
                path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        ).stdout
        streams = json.loads(output).get("streams") or [{}]
        return streams[0].get("color_transfer") or ""
    except (OSError, subprocess.SubprocessError, ValueError, AttributeError):
        logger.warning("could not probe the colour of %s", path, exc_info=True)
        return ""


def is_hdr(path):
    """Whether ``path`` carries a transfer curve that SDR cannot show as it is."""
    return transfer_characteristics(path) in HDR_TRANSFERS


def video_filter(path, scale=None):
    """The ``-filter:v`` argument for converting ``path``, tonemapped if need be.

    ``scale`` is whatever resizing the caller already wanted, kept first so that
    the expensive float pipeline runs on the smaller picture. ``None`` comes
    back when there is nothing to do at all, meaning the caller should pass no
    filter rather than an empty one, which ffmpeg rejects.
    """
    steps = [scale] if scale else []
    if is_hdr(path):
        if ffmpeg_budget.supports_filter("zscale"):
            steps.append(_TONEMAP)
        else:
            logger.warning(
                "this ffmpeg has no zscale, so %s cannot be tonemapped", path
            )
            steps.append(_FALLBACK)
    return ",".join(steps) or None
