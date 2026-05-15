"""Tests for the per-provider geocoding rate limiter.

The rate limiter exists because LibrePhotos was firing reverse_geocode
calls faster than nominatim's 1-request-per-second courtesy limit
permits, causing slow/timed-out responses and a self-reinforcing
hammer-the-server loop. These tests pin the sleep behaviour so
regressions don't silently disable it.
"""

from unittest.mock import patch

from django.test import SimpleTestCase

from api.geocode.rate_limit import (
    _MinDelayLimiter,
    get_limiter,
    reset_for_tests,
)


class MinDelayLimiterTest(SimpleTestCase):
    def test_first_call_does_not_sleep(self):
        limiter = _MinDelayLimiter(min_delay_seconds=1.0)
        with patch("api.geocode.rate_limit.time.sleep") as mock_sleep:
            with patch(
                "api.geocode.rate_limit.time.monotonic", side_effect=[100.0, 100.0]
            ):
                limiter.wait()
        mock_sleep.assert_not_called()

    def test_immediate_second_call_sleeps_for_remaining_delay(self):
        limiter = _MinDelayLimiter(min_delay_seconds=1.0)
        # First call records last_call=100.0; second call's elapsed=0.2,
        # so it should sleep for 0.8s.
        with patch("api.geocode.rate_limit.time.sleep") as mock_sleep:
            with patch(
                "api.geocode.rate_limit.time.monotonic",
                side_effect=[100.0, 100.0, 100.2, 100.2 + 0.8],
            ):
                limiter.wait()
                limiter.wait()
        mock_sleep.assert_called_once()
        slept = mock_sleep.call_args.args[0]
        self.assertAlmostEqual(slept, 0.8, places=6)

    def test_call_after_delay_passes_through_without_sleep(self):
        limiter = _MinDelayLimiter(min_delay_seconds=1.0)
        with patch("api.geocode.rate_limit.time.sleep") as mock_sleep:
            with patch(
                "api.geocode.rate_limit.time.monotonic",
                side_effect=[50.0, 50.0, 52.0, 52.0],
            ):
                limiter.wait()
                limiter.wait()
        mock_sleep.assert_not_called()

    def test_zero_delay_is_a_no_op(self):
        limiter = _MinDelayLimiter(min_delay_seconds=0.0)
        with patch("api.geocode.rate_limit.time.sleep") as mock_sleep:
            limiter.wait()
            limiter.wait()
            limiter.wait()
        mock_sleep.assert_not_called()


class GetLimiterTest(SimpleTestCase):
    def setUp(self):
        reset_for_tests()

    def tearDown(self):
        reset_for_tests()

    def test_returns_same_instance_per_provider(self):
        a1 = get_limiter("nominatim")
        a2 = get_limiter("nominatim")
        self.assertIs(a1, a2)

    def test_returns_different_instance_per_provider(self):
        a = get_limiter("nominatim")
        b = get_limiter("mapbox")
        self.assertIsNot(a, b)

    def test_nominatim_has_explicit_one_per_second_delay(self):
        # Nominatim's terms of use require >= 1 request/sec. The exact value
        # is documented in the module; this test guards against accidentally
        # weakening it.
        limiter = get_limiter("nominatim")
        self.assertGreaterEqual(limiter._min_delay, 1.0)

    def test_unknown_provider_gets_default_delay(self):
        limiter = get_limiter("some-future-provider")
        self.assertGreater(limiter._min_delay, 0)
