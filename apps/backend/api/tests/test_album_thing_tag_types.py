"""
Tests for _get_active_tag_thing_types in api/views/albums.py.

Validates that the function falls back gracefully when TAGGING_MODEL is not
present in the constance config (e.g. on upgraded systems with old settings).
"""

from unittest.mock import PropertyMock, patch

from django.test import TestCase

from api.views.albums import _get_active_tag_thing_types


class GetActiveTagThingTypesTestCase(TestCase):
    """Tests for the _get_active_tag_thing_types helper."""

    def test_places365_model_returns_places365_types(self):
        """When TAGGING_MODEL is 'places365', return places365 types."""
        with patch("constance.config") as mock_config:
            mock_config.TAGGING_MODEL = "places365"
            result = _get_active_tag_thing_types()
        self.assertEqual(result, ["places365_attribute", "places365_category"])

    def test_siglip2_model_returns_siglip2_types(self):
        """When TAGGING_MODEL is 'siglip2', return siglip2 types."""
        with patch("constance.config") as mock_config:
            mock_config.TAGGING_MODEL = "siglip2"
            result = _get_active_tag_thing_types()
        self.assertEqual(result, ["siglip2_tag"])

    def test_missing_tagging_model_falls_back_to_places365(self):
        """When TAGGING_MODEL is absent from constance config, fall back to places365."""
        with patch("constance.config") as mock_config:
            type(mock_config).TAGGING_MODEL = PropertyMock(
                side_effect=AttributeError("TAGGING_MODEL")
            )
            result = _get_active_tag_thing_types()
        self.assertEqual(result, ["places365_attribute", "places365_category"])
