from api.jobs import throttle

_MIN_DELAY_PER_PROVIDER = {
    "exiftool": 0,
    "nominatim": 1.1,
    "mapbox": 0.05,
    "maptiler": 0.05,
    "tomtom": 0.05,
    "opencage": 0.05,
}
_DEFAULT_MIN_DELAY = 0.05


def delay_for(provider: str) -> float:
    return _MIN_DELAY_PER_PROVIDER.get(provider, _DEFAULT_MIN_DELAY)


def wait(provider: str) -> None:
    throttle.wait(f"geocode:{provider}", delay_for(provider))
