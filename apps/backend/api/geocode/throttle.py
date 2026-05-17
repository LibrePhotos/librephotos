import json
import logging
import math
import time
from collections.abc import Mapping
from copy import deepcopy

logger = logging.getLogger(__name__)

SUPPORTED_GEOCODE_PROVIDERS = (
    "nominatim",
    "mapbox",
    "maptiler",
    "opencage",
    "tomtom",
)
GEOCODE_THROTTLE_CACHE_TTL_SECONDS = 5.0

_DEFAULT_REQUESTS_PER_SECOND = 1.0
_DEFAULT_BURST_SIZE = 1

_profiles_cache = {"expires_at": 0.0, "profiles": None}


def build_default_geocode_throttle_profiles() -> dict[str, dict[str, float | int | bool]]:
    return {
        provider: {
            "enabled": True,
            "requests_per_second": _DEFAULT_REQUESTS_PER_SECOND,
            "burst_size": _DEFAULT_BURST_SIZE,
        }
        for provider in SUPPORTED_GEOCODE_PROVIDERS
    }


def normalize_geocode_throttle_profiles(
    value,
) -> dict[str, dict[str, float | int | bool]]:
    if isinstance(value, str):
        payload = json.loads(value or "{}")
    else:
        payload = value

    if payload is None:
        payload = {}
    if not isinstance(payload, Mapping):
        raise ValueError("Geocode throttle profiles must be an object.")

    normalized = build_default_geocode_throttle_profiles()
    for provider in SUPPORTED_GEOCODE_PROVIDERS:
        raw_profile = payload.get(provider, {})
        if raw_profile is None:
            raw_profile = {}
        if not isinstance(raw_profile, Mapping):
            raise ValueError(f"Throttle profile for '{provider}' must be an object.")

        enabled = bool(raw_profile.get("enabled", normalized[provider]["enabled"]))
        requests_per_second = float(
            raw_profile.get(
                "requests_per_second", normalized[provider]["requests_per_second"]
            )
        )
        if not math.isfinite(requests_per_second) or requests_per_second < 0:
            raise ValueError(
                f"Throttle profile for '{provider}' must use a non-negative rate."
            )
        if enabled and requests_per_second <= 0:
            raise ValueError(
                f"Throttle profile for '{provider}' must use a positive rate when enabled."
            )

        burst_size = int(raw_profile.get("burst_size", normalized[provider]["burst_size"]))
        if burst_size < 1:
            raise ValueError(
                f"Throttle profile for '{provider}' must use a burst size of at least 1."
            )

        normalized[provider] = {
            "enabled": enabled,
            "requests_per_second": requests_per_second,
            "burst_size": burst_size,
        }

    return normalized


def serialize_geocode_throttle_profiles(value) -> str:
    return json.dumps(normalize_geocode_throttle_profiles(value), sort_keys=True)


def clear_geocode_throttle_profiles_cache():
    _profiles_cache["profiles"] = None
    _profiles_cache["expires_at"] = 0.0


def get_geocode_throttle_profiles() -> dict[str, dict[str, float | int | bool]]:
    now = time.monotonic()
    if (
        _profiles_cache["profiles"] is not None
        and now < float(_profiles_cache["expires_at"])
    ):
        return deepcopy(_profiles_cache["profiles"])

    from constance import config as site_config

    try:
        profiles = normalize_geocode_throttle_profiles(
            site_config.GEOCODE_THROTTLE_PROFILES
        )
    except (TypeError, ValueError, json.JSONDecodeError) as exc:
        logger.warning(
            "Invalid GEOCODE_THROTTLE_PROFILES runtime config, using defaults: %s",
            exc,
        )
        profiles = build_default_geocode_throttle_profiles()

    _profiles_cache["profiles"] = profiles
    _profiles_cache["expires_at"] = now + GEOCODE_THROTTLE_CACHE_TTL_SECONDS
    return deepcopy(profiles)


def get_geocode_throttle_profile(provider: str) -> dict[str, float | int | bool]:
    profiles = get_geocode_throttle_profiles()
    return profiles.get(provider, build_default_geocode_throttle_profiles()["nominatim"])
