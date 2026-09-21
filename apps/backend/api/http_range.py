"""Byte-range support for files this backend serves itself.

Installs that run behind the bundled nginx never reach this code for media
bytes: the backend authorizes and hands off with ``X-Accel-Redirect``, and
nginx answers ranges on its own. Installs that serve the frontend from Django
have no such helper, and until now every file they served arrived whole, from
the beginning, with no ``Accept-Ranges`` at all -- which is the same as saying
that no video in one of those installs could be sought.
"""

import os
import re

from django.http import FileResponse, HttpResponse, StreamingHttpResponse

#: Returned by :func:`parse_byte_range` when the range names bytes the file
#: does not have, which HTTP answers with 416 rather than the whole file.
UNSATISFIABLE = "unsatisfiable"

CHUNK_SIZE = 64 * 1024

_RANGE = re.compile(r"^bytes=(\d*)-(\d*)$")


def parse_byte_range(header, size):
    """Resolve a ``Range`` header against a file of ``size`` bytes.

    Returns an inclusive ``(start, end)`` pair, :data:`UNSATISFIABLE`, or None
    for "send the whole thing" -- which covers an absent header, a syntax this
    does not understand, and multi-range requests. Answering those with the
    complete file is always allowed and is what browsers expect; they only ever
    ask for one range when seeking.
    """
    if not header or size <= 0:
        return None
    match = _RANGE.match(header.strip())
    if not match:
        return None
    first, last = match.group(1), match.group(2)

    if not first:
        if not last:
            return None
        # "bytes=-500": the final 500 bytes, which is how a player finds the
        # index of an mp4 that was not written for streaming.
        length = min(int(last), size)
        if length == 0:
            return UNSATISFIABLE
        return size - length, size - 1

    start = int(first)
    if start >= size:
        return UNSATISFIABLE
    end = min(int(last), size - 1) if last else size - 1
    if end < start:
        return UNSATISFIABLE
    return start, end


def _read_range(handle, start, length):
    remaining = length
    try:
        handle.seek(start)
        while remaining > 0:
            chunk = handle.read(min(CHUNK_SIZE, remaining))
            if not chunk:
                break
            remaining -= len(chunk)
            yield chunk
    finally:
        handle.close()


def ranged_response(handle, size, range_header, content_type=None):
    """Serve an open file, honouring a single byte range if one was asked for.

    Takes the open handle rather than a path so that the caller keeps the one
    place where a missing or unreadable file is diagnosed, and so the file
    cannot change underneath between the two.
    """
    parsed = parse_byte_range(range_header, size)

    if parsed is UNSATISFIABLE:
        handle.close()
        response = HttpResponse(status=416)
        response["Content-Range"] = f"bytes */{size}"
        response["Accept-Ranges"] = "bytes"
        return response

    if parsed is None:
        response = FileResponse(handle)
        if content_type:
            response["Content-Type"] = content_type
        response["Accept-Ranges"] = "bytes"
        return response

    start, end = parsed
    length = end - start + 1
    response = StreamingHttpResponse(
        _read_range(handle, start, length),
        status=206,
        content_type=content_type or "application/octet-stream",
    )
    response["Content-Range"] = f"bytes {start}-{end}/{size}"
    response["Content-Length"] = length
    response["Accept-Ranges"] = "bytes"
    return response


def file_size(handle):
    return os.fstat(handle.fileno()).st_size
