"""The license a photo is offered under (#425): a fixed list with canonical URLs.

A photo carries one of these in ``PhotoMetadata.license`` (None: not stated).
The list is closed on purpose: a public page links only to the URLs below,
never to a URL read from a file or typed by a user, so a license link cannot
be turned into a phishing or ``javascript:`` link.

A file states its license in ``XMP-cc:License`` (Creative Commons' own
namespace) or, as Lightroom, digiKam and Flickr exports do, in
``XMP-xmpRights:WebStatement``. ``XMP-xmpRights:Marked`` True without either
is Lightroom's "Copyrighted": all rights reserved.
"""

from __future__ import annotations

import re
from collections.abc import Mapping

from django.db import models


class PhotoLicense(models.TextChoices):
    """The licenses LibrePhotos knows, by an SPDX-like id."""

    ALL_RIGHTS_RESERVED = "all-rights-reserved", "All rights reserved"
    CC_BY = "cc-by-4.0", "CC BY 4.0"
    CC_BY_SA = "cc-by-sa-4.0", "CC BY-SA 4.0"
    CC_BY_NC = "cc-by-nc-4.0", "CC BY-NC 4.0"
    CC_BY_NC_SA = "cc-by-nc-sa-4.0", "CC BY-NC-SA 4.0"
    CC_BY_ND = "cc-by-nd-4.0", "CC BY-ND 4.0"
    CC_BY_NC_ND = "cc-by-nc-nd-4.0", "CC BY-NC-ND 4.0"
    CC0 = "cc0-1.0", "CC0 1.0"
    PUBLIC_DOMAIN_MARK = "pdm-1.0", "Public Domain Mark 1.0"


LICENSE_MAX_LENGTH = 32

#: The deed of each license; "All rights reserved" has none.
LICENSE_URLS: dict[str, str] = {
    PhotoLicense.CC_BY: "https://creativecommons.org/licenses/by/4.0/",
    PhotoLicense.CC_BY_SA: "https://creativecommons.org/licenses/by-sa/4.0/",
    PhotoLicense.CC_BY_NC: "https://creativecommons.org/licenses/by-nc/4.0/",
    PhotoLicense.CC_BY_NC_SA: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    PhotoLicense.CC_BY_ND: "https://creativecommons.org/licenses/by-nd/4.0/",
    PhotoLicense.CC_BY_NC_ND: "https://creativecommons.org/licenses/by-nc-nd/4.0/",
    PhotoLicense.CC0: "https://creativecommons.org/publicdomain/zero/1.0/",
    PhotoLicense.PUBLIC_DOMAIN_MARK: "https://creativecommons.org/publicdomain/mark/1.0/",
}

# A deed URL as files carry it: either scheme, with or without "www.", and
# possibly pointing at a translated deed or the legal code.
_DEED_URL = re.compile(
    r"^https?://(?:www\.)?(creativecommons\.org/(?:licenses|publicdomain)/[a-z0-9-]+/[0-9.]+)"
    r"(?:/(?:deed|legalcode)(?:\.[a-z_-]+)?)?/?$",
    re.IGNORECASE,
)

_LICENSE_OF_DEED: dict[str, str] = {
    _DEED_URL.sub(r"\1", url).lower(): code for code, url in LICENSE_URLS.items()
}


def license_from_url(value: object) -> str | None:
    """The license whose deed ``value`` names, or None for any other text."""
    if not isinstance(value, str):
        return None
    match = _DEED_URL.match(value.strip())
    if match is None:
        return None
    return _LICENSE_OF_DEED.get(match.group(1).lower())


def license_of(values: Mapping[str, object]) -> str | None:
    """The license a file states (``photo_reader.EXIF_FIELDS`` values), or None.

    ``XMP-cc:License`` first, then a Creative Commons ``WebStatement``; any
    other ``WebStatement`` says nothing about the license. ``Marked`` True
    without a known license is all rights reserved.
    """
    for name in ("xmp_license", "xmp_web_statement"):
        found = license_from_url(values.get(name))
        if found is not None:
            return found
    if values.get("xmp_marked") is True:
        return PhotoLicense.ALL_RIGHTS_RESERVED
    return None


def license_url(code: str | None) -> str | None:
    """The deed of the license ``code``; None for all rights reserved or none."""
    return LICENSE_URLS.get(code) if code else None
