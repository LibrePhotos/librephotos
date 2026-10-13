"""The answers of the health probes (``api/views/health.py``).

Only for the OpenAPI schema: the views build these dicts themselves.
"""

from rest_framework import serializers

HEALTH_STATES = ("ok", "error")


class HealthCheckSerializer(serializers.Serializer[None]):
    """One dependency's state, as ``_check_postgresql`` and ``_check_queue`` report it."""

    status = serializers.ChoiceField(choices=HEALTH_STATES)
    error = serializers.CharField(
        required=False,
        help_text="Which dependency did not answer; only when status is error",
    )


class HealthChecksSerializer(serializers.Serializer[None]):
    postgresql = HealthCheckSerializer()
    queue = HealthCheckSerializer()


class HealthReadySerializer(serializers.Serializer[None]):
    """The readiness probe: error (and 503) when any dependency is down."""

    status = serializers.ChoiceField(choices=HEALTH_STATES)
    checks = HealthChecksSerializer()
