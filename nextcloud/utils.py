"""Utility helpers for Nextcloud integrations."""
from __future__ import annotations

from urllib.parse import urlparse


_ALLOWED_SCHEMES = {"http", "https"}


def valid_url(url: str | None) -> bool:
    """Validate that *url* is an HTTP(S) URL with a host component.

    The previous implementation only attempted to ``urlparse`` the string,
    which mistakenly accepted inputs such as ``javascript:alert(1)`` or
    ``ftp://example.com`` because ``urlparse`` rarely raises exceptions.
    We now ensure that the scheme is HTTP(S) and that a network location is
    present before treating the address as valid.
    """

    if not isinstance(url, str):
        return False

    candidate = url.strip()
    if not candidate:
        return False

    try:
        parsed = urlparse(candidate)
    except ValueError:
        return False

    if parsed.scheme.lower() not in _ALLOWED_SCHEMES:
        return False

    if not parsed.netloc:
        return False

    return True
