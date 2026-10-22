"""The answer and the body of ``/api/updates/`` (#2311, ``api.updates.check``)."""

from rest_framework import serializers

from api.drf.params import JsonStringField
from api.updates.check import UpdateStatus
from api.updates.versions import parse_version


class UpdateStatusSerializer(serializers.Serializer[UpdateStatus]):
    """The update check as admins see it."""

    enabled = serializers.BooleanField(
        help_text="Whether the daily check runs: the site setting is on and the"
        " environment does not turn it off."
    )
    locked = serializers.BooleanField(
        help_text="UPDATE_CHECK=false in the environment: the site setting cannot"
        " turn it on."
    )
    # A string, not an enum: a state a later server adds must not break clients.
    status = serializers.CharField(
        help_text="locked, off, development (no version to compare), not_checked,"
        " failed, up_to_date, available or skipped"
    )
    current = serializers.CharField(
        help_text="The release this server runs; empty for a source checkout."
    )
    latest = serializers.CharField(
        allow_null=True,
        help_text="The newest release the last check found for this install;"
        " null before the first check or while the check is off.",
    )
    update_available = serializers.BooleanField(
        help_text="latest is newer than current."
    )
    notice = serializers.BooleanField(
        help_text="Show the Update available card and the sidebar dot: an update"
        " is available, not skipped, and the card was not closed in the last week."
    )
    release_url = serializers.CharField(
        allow_null=True, help_text="The release's page on GitHub."
    )
    published_at = serializers.DateTimeField(allow_null=True)
    checked_at = serializers.DateTimeField(
        allow_null=True, help_text="When the last check ran; null before the first."
    )
    error = serializers.CharField(
        allow_null=True,
        help_text="Why the last check failed (timeout, unreachable, http_<status>,"
        " bad_response); null when it worked.",
    )
    install_type = serializers.CharField(help_text="windows, docker or source")
    how_to_update_url = serializers.CharField(
        help_text="The update steps for this install type in the docs."
    )
    skipped_release = serializers.CharField(
        allow_null=True, help_text="The release Skip this release hid."
    )
    snoozed_until = serializers.DateTimeField(
        allow_null=True,
        help_text="Until when the closed card stays hidden; null when it is not.",
    )


class SkipReleaseRequest(serializers.Serializer[None]):
    """The release to stop telling admins about."""

    version = JsonStringField(
        help_text="A release version such as 1.5.0; empty shows the newest"
        " release again."
    )

    def validate_version(self, value: str) -> str:
        version = value.strip()
        if version and parse_version(version) is None:
            raise serializers.ValidationError(
                "Give a release version such as 1.5.0, or nothing.",
                code="invalid_version",
            )
        return version
