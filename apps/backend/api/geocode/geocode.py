import logging

import geopy
from constance import config as site_config

from api.geocode import EXIFTOOL_PROVIDER, GEOCODE_VERSION
from api.models.photo_search import place_label
from api.runtime.features import feature_enabled

from . import exiftool_provider
from .config import get_provider_config, get_provider_parser
from .rate_limit import wait as wait_for_provider

logger = logging.getLogger(__name__)


def no_place() -> dict[str, object]:
    """The answer for a position the provider has no place for (open sea, a
    remote area): looked up, nothing there.

    Unlike ``{}``, a failed lookup, it is stored for the position, so the
    geolocation job does not ask again until the position changes (#2567).
    """
    return {"features": [], "places": [], "_v": GEOCODE_VERSION}


class Geocode:
    def __init__(self, provider: str) -> None:
        self._provider_config = get_provider_config(provider)
        self._parser = get_provider_parser(provider)
        self._geocoder = geopy.get_geocoder_for_service(provider)(
            **self._provider_config
        )

    def _missing_api_key(self) -> bool:
        """True (and warn) when the provider needs a key and MAP_API_KEY is unset.

        The constance default for MAP_API_KEY is "", so an unset key is falsy
        rather than None. Without this check geopy sends the request with an
        empty key and the provider rejects it.
        """
        if "api_key" in self._provider_config and not self._provider_config["api_key"]:
            logger.warning(
                "No API key found for map provider. Please set MAP_API_KEY in the admin panel or switch map provider."
            )
            return True
        return False

    def reverse(self, lat: float, lon: float) -> dict:
        if self._missing_api_key():
            return {}
        location = self._geocoder.reverse(f"{lat},{lon}")
        # geopy answers None when the provider has no place there, and raises
        # when the lookup fails.
        if location is None:
            return no_place()
        return self._parser(location)

    def search(self, query: str, limit: int = 5) -> list[dict]:
        """Forward geocoding: search for locations by name/address."""
        if self._missing_api_key():
            return []
        locations = self._geocoder.geocode(query, exactly_one=False, limit=limit)
        if not locations:
            return []
        return [
            {
                "display_name": loc.address,
                "lat": loc.latitude,
                "lon": loc.longitude,
            }
            for loc in locations
        ]


def reverse_geocode(lat: float, lon: float) -> dict:
    """The place at ``lat``, ``lon``: a parsed place, ``no_place()`` when the
    provider has none there, or ``{}`` when it could not be asked (reverse
    geocoding off, no API key, an error), which is worth trying again."""
    if not feature_enabled("REVERSE_GEOCODING"):
        logger.debug("Reverse geocoding is disabled")
        return {}
    provider = site_config.MAP_API_PROVIDER
    wait_for_provider(provider)
    try:
        if provider == EXIFTOOL_PROVIDER:
            return exiftool_provider.reverse(lat, lon)
        return Geocode(provider).reverse(lat, lon)
    except Exception as e:
        logger.warning("Error while reverse geocoding: %s", e)
        return {}


def reverse_geocode_label(lat: float, lon: float) -> str | None:
    """The place name at ``lat``, ``lon``, as a photo moved there would get it.

    None when reverse geocoding is turned off, "" when the provider has no
    name for the spot or fails. Waits for the provider's rate limit like the
    geolocation job does (``reverse_geocode``).
    """
    if not feature_enabled("REVERSE_GEOCODING"):
        return None
    return place_label(reverse_geocode(lat, lon))


def search_provider(provider: str) -> str:
    """The provider that searches places by name for the Map Provider *provider*.

    ExifTool's database knows town names only, not addresses, so with it the
    location picker's search asks Nominatim, at Nominatim's rate limit. Only
    the typed text goes out, never a photo's position.
    """
    return "nominatim" if provider == EXIFTOOL_PROVIDER else provider


def search_location(query: str, limit: int = 5) -> list[dict]:
    """Search for locations by name/address using the configured map provider
    (Nominatim for the offline one, ``search_provider``)."""
    provider = search_provider(site_config.MAP_API_PROVIDER)
    wait_for_provider(provider)
    try:
        return Geocode(provider).search(query, limit)
    except Exception as e:
        logger.warning("Error while searching location: %s", e)
        return []
