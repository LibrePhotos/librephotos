"""Id regexes and named URL converters, the one place an id kind is spelled.

The legacy routes in ``librephotos/urls.py`` stay ``re_path()``: their optional
trailing slash (``/?$``) is something ``path()`` cannot express, so they take
the id regexes below as shared constants. New routes use ``path()`` with the
converters registered here, for example ``path("api/photos/<photo_key:photo_id>/x/", ...)``.
A photo key is a photo UUID or an image hash; both are lowercase hex with
dashes, so the class covers the 64-hex hash too.
"""

from django.urls import register_converter
from django.urls.converters import StringConverter

# A photo UUID or an image hash (the 64-hex hash is a subset of this class).
PHOTO_KEY_REGEX = r"[0-9a-f-]+"
# A lowercase hex image hash or file-variant hash.
IMAGE_HASH_REGEX = r"[a-f0-9]+"
# Stack, duplicate and metadata-edit ids. The legacy routes accept this loose
# class; new routes use Django's ``<uuid:...>`` converter instead.
UUID_LIKE_REGEX = r"[0-9a-f-]+"


class PhotoKeyConverter(StringConverter):
    regex = PHOTO_KEY_REGEX


class ImageHashConverter(StringConverter):
    regex = IMAGE_HASH_REGEX


register_converter(PhotoKeyConverter, "photo_key")
register_converter(ImageHashConverter, "image_hash")
