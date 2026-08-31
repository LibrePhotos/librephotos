"""How much of the machine an ffmpeg conversion is allowed to take.

Two conversions run in this codebase and they want opposite things. The live
one (:class:`api.views.views.VideoTranscoder`) has somebody watching it, so it
must stay ahead of playback and must not be niced behind anything. The cached
one (:mod:`api.transcode_cache`) has nobody waiting, so it stands back. What
they share is that ffmpeg, left alone, helps itself to the whole host: no
thread limit and no output rate limit, so one person opening one video can
starve the web UI, the scan workers and every other user. This module is the
single place that decides what "the whole host" gets narrowed to.

Two levers, and they bound different things.

``-threads`` caps how many cores the work may occupy at once. It has to be
given **twice** to mean what it looks like it means: before the input it sets
the decoder's threads, after the input the encoder's -- and neither of them
governs the filter pool, which needs ``-filter_threads`` of its own.

How much that is worth depends on how much of the machine ffmpeg could
otherwise have taken. Measured on a 4-core host converting 1080p to 720p, where
the work parallelises to about 2.7 cores by itself: 2.67 cores unbounded, 2.58
with ``-threads`` after the input only, 2.44 with it on both sides, 2.38 adding
``-filter_threads``, and 0.99 -- exactly the cap -- with all three set to one.
The cap holds; what a 4-core host cannot show is how much it holds *back*,
since the workload nearly saturates it unaided. The gap is what grows with the
core count, which is where the complaint in #1920 came from.

``-readrate`` caps how fast the conversion runs relative to real time, which is
the lever ``-threads`` cannot pull: a viewer needs output a little faster than
playback and nothing more, so a fast host converting a two-hour film at twenty
times real time is burning cores on footage nobody may ever reach.
``-readrate_initial_burst`` exempts the first few seconds, so playback still
starts at once and the browser still gets a buffer. Both are relatively recent
ffmpeg options, so their presence is probed rather than assumed.
"""

import logging
import os
import shutil
import subprocess

logger = logging.getLogger(__name__)

# Probed once per process: asking ffmpeg for its full help costs a subprocess and
# about a megabyte of text, and the answer cannot change under us. The help text
# is cached rather than each answer, so asking about a second option is free.
_help_text = None


def cpu_share(fraction=2):
    """Cores to allow, as a fraction of what the machine has. Never fewer than one.

    A fraction below one is read as "no limit worth applying" rather than as a
    division to attempt, so a hand-edited settings file cannot take the media
    endpoint down with a ZeroDivisionError.
    """
    cores = os.cpu_count() or 2
    if fraction < 1:
        return cores
    return max(1, cores // fraction)


def supports(option):
    """Whether this ffmpeg understands ``option``, e.g. ``"readrate"``.

    ``-readrate`` arrived in ffmpeg 5.0 and ``-readrate_initial_burst`` in 6.1,
    and an unknown option is a hard failure -- ffmpeg exits rather than ignoring
    it, which would turn every video into a broken one. This is not a
    hypothetical: the CPU image is built on ubuntu:noble and has both, while the
    GPU image is built on ubuntu 22.04, whose ffmpeg is 4.4 and has neither.
    Hosts supplying their own ffmpeg can be anything at all.
    """
    # Options are listed one per line as "-name  description". Match the whole
    # name, so that asking about "readrate" is not answered by
    # "readrate_initial_burst".
    return any(
        line.strip().split(" ", 1)[0] == f"-{option}"
        for line in _full_help().splitlines()
    )


def _full_help():
    global _help_text
    if _help_text is None:
        _help_text = _read_full_help()
    return _help_text


def _read_full_help():
    if not shutil.which("ffmpeg"):
        return ""
    try:
        return subprocess.run(
            ["ffmpeg", "-hide_banner", "-h", "full"],
            capture_output=True,
            text=True,
            timeout=30,
        ).stdout
    except (OSError, subprocess.SubprocessError):
        logger.warning("could not ask ffmpeg which options it supports", exc_info=True)
        return ""


def reset_probe_cache():
    """Forget what was probed. For tests, which vary the ffmpeg they pretend to have."""
    global _help_text
    _help_text = None
