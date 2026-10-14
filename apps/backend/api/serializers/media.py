"""Request input of the media views (``api/views/media.py``), and the answer
of the serving diagnostics (``api/views/serving_diagnostics.py``)."""

from rest_framework import serializers

from api.drf.params import QueryFlagField
from api.serializers.fields import declare_fields
from api.serving.permissions import (
    CAUSE_MISSING,
    CAUSE_MODE_BITS,
    CAUSE_NOT_MODE_BITS,
    CAUSE_UNKNOWN,
)

# What diagnose_media_path found.
DIAGNOSIS_CAUSES = (CAUSE_MISSING, CAUSE_MODE_BITS, CAUSE_NOT_MODE_BITS, CAUSE_UNKNOWN)


class MediaQuery(serializers.Serializer[None]):
    transcode = QueryFlagField(
        true_values={"1"},
        help_text="1 asks for a video this browser cannot play to be converted",
    )


class BlockingPathSerializer(serializers.Serializer[None]):
    """The path component that stopped the web server (``Blocking``)."""

    path = serializers.CharField()
    # A string, not an enum: a second "kind" enum would rename the person
    # kind's KindEnum component.
    kind = serializers.CharField(help_text="directory or file")
    mode = serializers.CharField(
        required=False, help_text="Octal mode bits; only for a path it could stat"
    )
    uid = serializers.IntegerField(required=False)
    gid = serializers.IntegerField(required=False)


class WebServerIdsSerializer(serializers.Serializer[None]):
    uid = serializers.IntegerField()
    gid = serializers.IntegerField()


class MountSummarySerializer(serializers.Serializer[None]):
    """The mount backing the path (``MountSummary``)."""

    point = serializers.CharField()
    type = serializers.CharField(help_text="The file system type")
    options = serializers.ListField(child=serializers.CharField())
    permissions_from_mount = serializers.BooleanField(
        help_text="The file system takes its permissions from mount options"
    )
    network = serializers.BooleanField()


# ``read_only`` names a Field attribute, which a class body cannot redefine.
declare_fields(MountSummarySerializer, read_only=serializers.BooleanField())


class MediaDiagnosisSerializer(serializers.Serializer[None]):
    """``GET /api/media/diagnostics/{fname}/`` (admin): why the web server
    cannot serve a photo's original (``diagnose_media_path``).

    A photo without a file has no path, ``webserver`` or ``mount``.
    """

    path = serializers.CharField(allow_null=True)
    exists = serializers.BooleanField()
    readable_by_webserver = serializers.BooleanField()
    cause = serializers.ChoiceField(
        choices=DIAGNOSIS_CAUSES,
        help_text="mode_bits names the path in blocking; not_mode_bits: the "
        "bits allow the read, so something chmod cannot reach refused it",
    )
    blocking = BlockingPathSerializer(allow_null=True)
    webserver = WebServerIdsSerializer(required=False)
    mount = MountSummarySerializer(
        required=False, allow_null=True, help_text="null when no mount matches"
    )
    remedies = serializers.ListField(
        child=serializers.CharField(), help_text="Kinds of fix, most applicable first"
    )
