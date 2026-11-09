"""How long a browser may keep a thumbnail, and how it asks whether it changed.

Thumbnails used to go out with no caching headers at all, so a grid tile that
scrolled out and back in, or any reload, downloaded its picture again through
the media view's permission check. Two cases now:

- A thumbnail asked for with ``?v=`` (the grid passes a digest of the photo's
  ThumbHash, which changes whenever its thumbnails are built again, e.g. after
  a rotation) is kept for a year without asking again: a new picture has a new
  address.
- Without it (the lightbox, other clients) the browser keeps a copy and asks
  every time; the answer is a bodiless 304 while the file is unchanged.

``private``: thumbnails are behind a login and must stay out of shared caches.
"""

from __future__ import annotations

import os

from django.http import HttpRequest, HttpResponseBase
from django.utils.cache import get_conditional_response

# The media paths whose files are thumbnails.
THUMBNAIL_KINDS = frozenset(
    {"thumbnails_big", "square_thumbnails", "square_thumbnails_small"}
)

VERSIONED = "private, max-age=31536000, immutable"
REVALIDATED = "private, no-cache"


def file_etag(stat: os.stat_result) -> str:
    """A validator that changes whenever the file is written: its mtime and size."""
    return f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'


def not_modified(request: HttpRequest | None, etag: str) -> HttpResponseBase | None:
    """The 304 for a request whose ``If-None-Match`` names ``etag``, else None."""
    if request is None:
        return None
    response = get_conditional_response(request, etag=etag)
    if response is not None:
        # A 304 repeats the validator, so the browser keeps matching it.
        response["ETag"] = etag
    return response


def cache_thumbnail(
    request: HttpRequest, kind: str, response: HttpResponseBase
) -> HttpResponseBase:
    """Set how long the browser may keep ``response``, when it is a thumbnail.

    Errors and responses that already say (a live transcode) are left alone.
    """
    if kind not in THUMBNAIL_KINDS or response.status_code not in (200, 206, 304):
        return response
    if response.has_header("Cache-Control"):
        return response
    response["Cache-Control"] = VERSIONED if request.GET.get("v") else REVALIDATED
    return response
