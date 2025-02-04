import geopy
from constance import config as site_config

from api import util

from .config import get_provider_config, get_provider_parser


class Geocode:
    def __init__(self, provider):
        self._provider_config = get_provider_config(provider)
        self._parser = get_provider_parser(provider)
        self._geocoder = geopy.get_geocoder_for_service(provider)(
            **self._provider_config
        )

    def reverse(self, lat: float, lon: float) -> dict:
        if (
            "geocode_args" in self._provider_config
            and "api_key" in self._provider_config["geocode_args"]
            and self._provider_config["geocode_args"]["api_key"] is None
        ):
            util.logger.warning(
                "No API key found for map provider. Please set MAP_API_KEY in the admin panel or switch map provider."
            )
            return {}
        location = self._geocoder.reverse(f"{lat},{lon}")
        return self._parser(location)


def reverse_geocode(lat: float, lon: float) -> dict:
    try:
        return Geocode(site_config.MAP_API_PROVIDER).reverse(lat, lon)
    except Exception as e:
        util.logger.warning(f"Error while reverse geocoding: {e}")
        return {}
