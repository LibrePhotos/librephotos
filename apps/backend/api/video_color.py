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

Whether a source is HDR is asked once, at scan time, by :func:`probe`, and kept
on the photo (#2045). Every conversion used to run an ffprobe of its own -- three
of them for each new video's thumbnails alone, and another on every play. The
callers pass the stored value as ``transfer``; ``None`` means the video was never
probed, and only then is the file asked again, so a library scanned before the
value existed keeps working until the backfill reaches it.
"""

import json
import logging
import os
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

# The pixel formats libx264 was already handed as 8-bit 4:2:0 before every
# conversion forced it. A source in anything else came out High 10 or High
# 4:2:2 -- a thumbnail or cached copy no browser plays.
BROWSER_PIXEL_FORMATS = frozenset({"yuv420p", "yuvj420p"})

# npl=100 is the display being mapped *to*, not the one the source was graded
# for: 100 nits is SDR reference white.
#
# desat=0 is the part that matters most. The filter's default, 2.0, fades
# anything brighter than twice reference white towards white -- and HDR puts
# ordinary diffuse white near 203 nits (BT.2408), right at that line, with the
# sky and every highlight above it. Graded at 1000 nits, a picture came out 98%
# flat white. mobius is linear up to a knee and rolls off only above it, so the
# midtones keep their brightness and colour: of the three operators it came
# closest to the SDR original in every test, where hable left a 100-nit picture
# with half its saturation and a quarter of its brightness gone.
_TONEMAP = (
    "zscale=t=linear:npl=100,"
    "format=gbrpf32le,"
    "zscale=p=bt709,"
    "tonemap=mobius:desat=0,"
    "zscale=t=bt709:m=bt709:r=tv,"
    "format=yuv420p"
)

# Without zscale the colours cannot be fixed, but the bit depth still can be. An
# HDR source is 10-bit, and libx264 handed 10-bit samples encodes High 10, which
# no browser decodes -- so the untonemapped fallback is at least a video that
# plays, washed out, rather than one that does not play at all.
_FALLBACK = "format=yuv420p"

# libx264 encodes whatever pixel format it is handed, and a browser plays only
# 8-bit 4:2:0 H.264. A 10-bit SDR phone clip, or a 4:2:2 one from a camera, needs
# no tonemapping but comes out as High 10 or High 4:2:2 all the same -- a video
# that does not play. Given once more after the filter chain it costs nothing
# where the chain already ends in yuv420p.
_PIXEL_FORMAT = ["-pix_fmt", "yuv420p"]

# What the tonemapped picture is. Without the tags the browser has to guess, and
# the guess is bt709 only by convention.
_BT709_TAGS = [
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-colorspace",
    "bt709",
]

# The stored fields :func:`probe` fills, by what ffprobe calls them.
PROBED_FIELDS = {
    "video_codec": ("streams", "codec_name"),
    "video_pixel_format": ("streams", "pix_fmt"),
    "video_color_transfer": ("streams", "color_transfer"),
    "video_container": ("format", "format_name"),
}


def can_probe():
    """Whether this host has an ffprobe to ask."""
    return bool(shutil.which("ffprobe"))


def probe(path):
    """What the browser-support and tonemapping decisions need about ``path``.

    One ffprobe, run by the scan, answering for the life of the file: the first
    video stream's codec, pixel format and transfer curve, and the container.
    ExifTool, which the scan already runs, reads the colour only from a MOV or
    MP4 ``colr`` atom -- nothing at all for Matroska -- and cannot tell 8-bit
    from 10-bit, so it cannot stand in for this.

    A value the file does not carry comes back as an empty string, which is an
    answer: an untagged video is SDR. ``None`` means there is no answer yet --
    no ffprobe, a file that is not there right now, such as one on a drive
    that is not mounted -- and is what makes the backfill try again on the next
    scan instead of settling on a guess.

    A file that is there and that ffprobe refuses (a truncated upload, a
    "moov atom not found") is answered with empty strings, as if untagged.
    Asking it again would only fail again, and would queue the backfill after
    every scan for good; the live probe it replaces read it as SDR as well.
    """
    if not can_probe():
        return None
    try:
        completed = subprocess.run(
            [
                binaries.ffprobe(),
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=codec_name,pix_fmt,color_transfer:format=format_name",
                "-of",
                "json",
                path,
            ],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if completed.returncode != 0:
            logger.warning(
                "could not probe %s: %s", path, (completed.stderr or "").strip()
            )
            if os.path.isfile(path):
                return dict.fromkeys(PROBED_FIELDS, "")
            return None
        output = json.loads(completed.stdout)
        sections = {
            "streams": (output.get("streams") or [{}])[0],
            "format": output.get("format") or {},
        }
    except (OSError, subprocess.SubprocessError, ValueError, AttributeError):
        logger.warning("could not probe %s", path, exc_info=True)
        return None
    values = {}
    for field, (section, key) in PROBED_FIELDS.items():
        value = sections[section].get(key) or ""
        # ffprobe's word for a tag that is present but says nothing.
        values[field] = "" if value == "unknown" else str(value)
    return values


def record(photo):
    """Probe ``photo``'s video and store the answer on it.

    Returns whether there was an answer. Without one the fields are left as they
    were, so a video that could not be read keeps its old values, or stays
    unprobed and is retried.
    """
    values = probe(photo.main_file.path)
    if values is None:
        return False
    for field, value in values.items():
        setattr(photo, field, value)
    photo.save(save_metadata=False, update_fields=list(values))
    return True


def converted_wrongly_before(photo):
    """Whether what was made from ``photo`` before it was probed is unusable.

    Thumbnails and the cached copy made before every conversion was tonemapped
    and forced to 8-bit 4:2:0: an HDR source's came out washed out, a 10-bit or
    4:2:2 one's came out as an H.264 profile browsers do not play. Both stay
    that way, since a thumbnail or cached copy that exists is kept. An empty
    pixel format is a file that did not say, and is left alone.
    """
    if photo.video_color_transfer in HDR_TRANSFERS:
        return True
    pixel_format = photo.video_pixel_format or ""
    return bool(pixel_format) and pixel_format not in BROWSER_PIXEL_FORMATS


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


def _is_hdr(path, transfer):
    """The stored answer when there is one, the file's own otherwise."""
    if transfer is None:
        return is_hdr(path)
    return transfer in HDR_TRANSFERS


def _filter_chain(path, scale, transfer):
    """The filter steps, and whether they include the tonemap."""
    steps = [scale] if scale else []
    if not _is_hdr(path, transfer):
        return steps, False
    if ffmpeg_budget.supports_filter("zscale"):
        steps.append(_TONEMAP)
        return steps, True
    logger.warning("this ffmpeg has no zscale, so %s cannot be tonemapped", path)
    steps.append(_FALLBACK)
    return steps, False


def video_filter(path, scale=None, transfer=None):
    """The ``-filter:v`` argument for converting ``path``, tonemapped if need be.

    ``scale`` is whatever resizing the caller already wanted, kept first so that
    the expensive float pipeline runs on the smaller picture. ``transfer`` is the
    value the scan stored; ``None`` probes the file instead. ``None`` comes
    back when there is nothing to do at all, meaning the caller should pass no
    filter rather than an empty one, which ffmpeg rejects.
    """
    steps, _ = _filter_chain(path, scale, transfer)
    return ",".join(steps) or None


def h264_video_args(path, scale=None, transfer=None):
    """Everything a libx264 conversion of ``path`` needs to come out playable.

    The filter from :func:`video_filter`, a pixel format a browser decodes, and
    -- when the picture was tonemapped -- the tags saying it is now bt709. An
    untonemapped source keeps whatever its own tags said: labelling a bt601
    phone clip bt709 would shift its colours instead of fixing them.
    """
    steps, tonemapped = _filter_chain(path, scale, transfer)
    args = ["-filter:v", ",".join(steps)] if steps else []
    args += _PIXEL_FORMAT
    if tonemapped:
        args += _BT709_TAGS
    return args
