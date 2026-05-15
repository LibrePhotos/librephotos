"""Per-provider request rate limiting for reverse geocoding.

Nominatim's public terms of use require at most one request per second per
client. LibrePhotos currently fires reverse-geocode calls as fast as the
geolocation_job loop hands out photos, which is faster than nominatim
tolerates — they respond with slow or empty replies that then time out,
which the loop interprets as "move on" and pounds the server harder.

This module sleeps just enough between successive calls within a single
worker process to honor a configurable minimum delay per provider.

Limitations:
- The state is module-level (per-process). With multiple django-q2 worker
  processes geocoding in parallel, each worker independently respects the
  delay, so aggregate request rate scales with worker count. For
  LibrePhotos's typical 1-2 workers this stays inside nominatim's actual
  enforcement window (hundreds of req/min).
- Only matters when calls are issued in tight succession from the same
  worker; once the limiter's last-call timestamp has expired naturally,
  the next call goes through without delay.
"""

import threading
import time

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


class _MinDelayLimiter:
    def __init__(self, min_delay_seconds: float):
        self._min_delay = min_delay_seconds
        self._lock = threading.Lock()
        self._last_call = 0.0

    def wait(self) -> None:
        """Block until at least ``min_delay_seconds`` have passed since the last call."""
        if self._min_delay <= 0:
            return
        with self._lock:
            elapsed = time.monotonic() - self._last_call
            remaining = self._min_delay - elapsed
            if remaining > 0:
                time.sleep(remaining)
            self._last_call = time.monotonic()


_limiters: dict[str, _MinDelayLimiter] = {}
_limiters_lock = threading.Lock()


def get_limiter(provider: str) -> _MinDelayLimiter:
    with _limiters_lock:
        limiter = _limiters.get(provider)
        if limiter is None:
            delay = _MIN_DELAY_PER_PROVIDER.get(provider, _DEFAULT_MIN_DELAY)
            limiter = _MinDelayLimiter(delay)
            _limiters[provider] = limiter
        return limiter


def reset_for_tests() -> None:
    """Clear the limiter cache. Use only from test setUp/tearDown."""
    with _limiters_lock:
        _limiters.clear()
