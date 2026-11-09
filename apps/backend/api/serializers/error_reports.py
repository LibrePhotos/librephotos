"""The saved error reports (#2938): the Error reports page and the web app's forwarder."""

from rest_framework import serializers

from api.models import ErrorReport

# A browser envelope with a few errors and their stacks fits easily; more is
# not an error report.
MAX_ENVELOPE_CHARACTERS = 200_000


class ErrorReportSerializer(serializers.ModelSerializer[ErrorReport]):
    """One saved report as the list shows it; Download has the whole event."""

    class Meta:
        model = ErrorReport
        fields = (
            "id",
            "source",
            "title",
            "level",
            "release",
            "occurrences",
            "first_seen",
            "last_seen",
            "sent_at",
        )
        read_only_fields = fields
        extra_kwargs = {
            "title": {"help_text": "The error and its message, scrubbed."},
            "occurrences": {
                "help_text": "How often it happened; repeats within a day count here."
            },
            "sent_at": {"help_text": "When it was sent; null while it is only saved."},
        }

    def get_fields(self) -> dict[str, serializers.Field]:
        fields = super().get_fields()
        # A string, not an enum: a source a later server adds must not break
        # the clients that parse the list. Declared here rather than as a
        # class attribute, which would shadow Field.source.
        fields["source"] = serializers.CharField(
            read_only=True, help_text="server (the backend) or browser (the web app)."
        )
        return fields


class ErrorReportSendAllSerializer(serializers.Serializer[None]):
    """What Send all did."""

    sent = serializers.IntegerField(help_text="Reports delivered.")
    failed = serializers.IntegerField(help_text="Reports the server did not take.")


class BrowserErrorReportRequest(serializers.Serializer[None]):
    """A Sentry envelope from the web app's SDK, as text."""

    envelope = serializers.CharField(
        max_length=MAX_ENVELOPE_CHARACTERS,
        trim_whitespace=False,
        help_text="The envelope the browser SDK built; only its error events are kept.",
    )


class BrowserErrorReportSerializer(serializers.Serializer[None]):
    """How many of the envelope's errors were saved."""

    saved = serializers.IntegerField()
