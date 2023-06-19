import geopy
from constance import config as site_config

from .config import get_provider_config, get_provider_parser


class Geocode:
    def __init__(self, provider):
        provider_config = get_provider_config(provider)
        self._parser = get_provider_parser(provider)
        self._geocoder = geopy.get_geocoder_for_service(provider)(**provider_config)

    def reverse(self, lat: float, lon: float) -> dict:
        location = self._geocoder.reverse(f"{lat},{lon}")
        return self._parser(location)


def reverse_geocode(lat: float, lon: float) -> dict:
    return Geocode(site_config.MAP_API_PROVIDER).reverse(lat, lon)
