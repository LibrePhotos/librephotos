"""Per-provider request rate limiting for reverse geocoding.

Nominatim's public terms of use require at most one request per second per
client. LibrePhotos fires reverse-geocode calls as fast as the
geolocation_job loop hands out photos, which is faster than nominatim
tolerates — they respond with slow or empty replies that then time out,
which the loop interprets as "move on" and pounds the server harder.

This module enforces a per-provider minimum delay between successive calls.
State is stored in a ``diskcache.Cache`` so multiple django-q2 worker
processes coordinate through it — without that, an N-worker deployment
would scale the request rate by N and re-create the original abuse pattern.

The coordination loop reads the last-call timestamp, computes how long is
left in the delay window, sleeps that long outside the cache transaction,
then loops and re-checks: if another worker claimed the slot during the
sleep, we wait again until the next window opens.
"""

import os
import time

import diskcache
from django.conf import settings

# Minimum seconds between successive calls to each provider. Nominatim's
# public terms of use call for >=1 req/sec; commercial providers tolerate
# much higher rates, but a small floor here protects against accidentally
# hammering them while still letting the geolocation job make progress.
_MIN_DELAY_PER_PROVIDER = {
    "nominatim": 1.1,
    "mapbox": 0.05,
    "maptiler": 0.05,
    "tomtom": 0.05,
    "opencage": 0.05,
}
_DEFAULT_MIN_DELAY = 0.05

_CACHE_SUBDIR = "geocode_rate_limit"
_LAST_CALL_KEY = "last_call:{provider}"

_cache: diskcache.Cache | None = None


def _now() -> float:
    """Wall-clock indirection so tests can patch without touching
    ``diskcache``'s own ``time.time`` usage during cache init and bookkeeping.
    """
    return time.time()


def _sleep(seconds: float) -> None:
    """Sleep indirection — patched alongside :func:`_now` in tests."""
    time.sleep(seconds)


def _get_cache() -> diskcache.Cache:
    global _cache
    if _cache is None:
        cache_dir = os.path.join(settings.BASE_DATA, _CACHE_SUBDIR)
        _cache = diskcache.Cache(cache_dir)
    return _cache


def _delay_for(provider: str) -> float:
    return _MIN_DELAY_PER_PROVIDER.get(provider, _DEFAULT_MIN_DELAY)


def wait(provider: str) -> None:
    """Block until ``_delay_for(provider)`` seconds have passed since the
    last call recorded against ``provider`` in the shared cache.

    Safe to call concurrently from multiple worker processes; the cache
    transaction serialises the read-modify-write of the timestamp, and
    losers in the race re-check after sleeping.
    """
    delay = _delay_for(provider)
    if delay <= 0:
        return
    cache = _get_cache()
    key = _LAST_CALL_KEY.format(provider=provider)
    while True:
        with cache.transact():
            now = _now()
            last = cache.get(key, default=0.0)
            elapsed = now - last
            if elapsed >= delay:
                cache.set(key, now)
                return
            remaining = delay - elapsed
        # Sleep outside the transaction so we don't hold the lock.
        _sleep(remaining)


def reset_for_tests() -> None:
    """Clear the shared timestamps. Use only from test setUp/tearDown."""
    global _cache
    if _cache is not None:
        _cache.clear()
        _cache.close()
        _cache = None
