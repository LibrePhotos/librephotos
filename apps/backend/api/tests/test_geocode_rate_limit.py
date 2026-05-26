"""Tests for the per-provider geocoding rate limiter.

The rate limiter exists because LibrePhotos was firing reverse_geocode
calls faster than nominatim's 1-request-per-second courtesy limit
permits, causing slow/timed-out responses and a self-reinforcing
hammer-the-server loop. State is held in a ``diskcache.Cache`` so
multiple django-q2 worker processes coordinate through one set of
timestamps instead of each independently respecting the delay.

These tests pin the sleep behaviour, provider configuration, and
cross-process coordination so regressions don't silently disable any
of those properties.
"""

import tempfile
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from api.geocode import rate_limit


class WaitBehaviourTest(SimpleTestCase):
    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self._override = override_settings(BASE_DATA=self._tmpdir.name)
        self._override.enable()
        rate_limit.reset_for_tests()

    def tearDown(self):
        rate_limit.reset_for_tests()
        self._override.disable()
        self._tmpdir.cleanup()

    def test_first_call_does_not_sleep(self):
        # Fresh cache: no prior timestamp, so the wait() short-circuits
        # without sleeping regardless of the configured delay.
        with patch("api.geocode.rate_limit._sleep") as mock_sleep:
            with patch("api.geocode.rate_limit._now", return_value=1000.0):
                rate_limit.wait("nominatim")
        mock_sleep.assert_not_called()

    def test_immediate_second_call_sleeps_for_remaining_delay(self):
        # First call records last_call=1000.0. Second call's first iteration
        # sees now=1000.2 (elapsed 0.2 vs 1.1 nominatim delay), sleeps for
        # the 0.9s remaining, then the second iteration finds elapsed=1.1
        # and claims the slot.
        with patch("api.geocode.rate_limit._sleep") as mock_sleep:
            with patch(
                "api.geocode.rate_limit._now",
                side_effect=[1000.0, 1000.2, 1001.1],
            ):
                rate_limit.wait("nominatim")
                rate_limit.wait("nominatim")
        mock_sleep.assert_called_once()
        slept = mock_sleep.call_args.args[0]
        self.assertAlmostEqual(slept, 0.9, places=6)

    def test_call_after_delay_passes_through_without_sleep(self):
        # Two calls 2 seconds apart, with the 1.1s nominatim window — the
        # second must not sleep.
        with patch("api.geocode.rate_limit._sleep") as mock_sleep:
            with patch(
                "api.geocode.rate_limit._now",
                side_effect=[1000.0, 1002.0],
            ):
                rate_limit.wait("nominatim")
                rate_limit.wait("nominatim")
        mock_sleep.assert_not_called()

    def test_zero_delay_provider_is_a_no_op(self):
        # All real providers have positive delays so we override the table
        # to verify the zero-delay fast path.
        with patch.dict(
            "api.geocode.rate_limit._MIN_DELAY_PER_PROVIDER",
            {"nominatim": 0.0},
        ):
            with patch("api.geocode.rate_limit._sleep") as mock_sleep:
                rate_limit.wait("nominatim")
                rate_limit.wait("nominatim")
                rate_limit.wait("nominatim")
        mock_sleep.assert_not_called()

    def test_providers_have_independent_timestamps(self):
        # Calling wait() on one provider must not delay calls on a different
        # provider — they share a cache but key by provider name.
        with patch("api.geocode.rate_limit._sleep") as mock_sleep:
            with patch(
                "api.geocode.rate_limit._now",
                side_effect=[1000.0, 1000.0001],
            ):
                rate_limit.wait("nominatim")
                rate_limit.wait("mapbox")
        mock_sleep.assert_not_called()


class ProviderConfigTest(SimpleTestCase):
    def test_nominatim_has_explicit_one_per_second_delay(self):
        # Nominatim's terms of use require >= 1 request/sec. The exact value
        # is documented in the module; this test guards against accidentally
        # weakening it.
        self.assertGreaterEqual(rate_limit._delay_for("nominatim"), 1.0)

    def test_unknown_provider_gets_default_delay(self):
        self.assertGreater(rate_limit._delay_for("some-future-provider"), 0)


class CrossProcessCoordinationTest(SimpleTestCase):
    """The whole point of switching from per-process state to a diskcache
    is that a second worker process sees timestamps the first one wrote.
    We simulate the second worker by closing and re-opening the cache.
    """

    def setUp(self):
        self._tmpdir = tempfile.TemporaryDirectory()
        self._override = override_settings(BASE_DATA=self._tmpdir.name)
        self._override.enable()
        rate_limit.reset_for_tests()

    def tearDown(self):
        rate_limit.reset_for_tests()
        self._override.disable()
        self._tmpdir.cleanup()

    def test_fresh_cache_handle_sees_prior_workers_timestamp(self):
        with patch("api.geocode.rate_limit._sleep") as mock_sleep:
            with patch("api.geocode.rate_limit._now", return_value=2000.0):
                rate_limit.wait("nominatim")
        mock_sleep.assert_not_called()
        # Simulate a different worker process by dropping the cache handle.
        # The next call must re-open the same directory and find the
        # previously written timestamp.
        rate_limit._cache.close()
        rate_limit._cache = None
        with patch("api.geocode.rate_limit._sleep") as mock_sleep:
            with patch(
                "api.geocode.rate_limit._now",
                side_effect=[2000.1, 2001.2],
            ):
                rate_limit.wait("nominatim")
        mock_sleep.assert_called_once()
