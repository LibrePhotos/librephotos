from rest_framework import serializers

from api.drf.params import QueryFlagField
from api.models import LongRunningJob
from api.serializers.simple import SimpleUserSerializer


class LongRunningJobSerializer(serializers.ModelSerializer):
    job_type_str = serializers.SerializerMethodField()
    started_by = SimpleUserSerializer(read_only=True)

    class Meta:
        model = LongRunningJob
        fields = (
            "job_id",
            "queued_at",
            "finished",
            "finished_at",
            "started_at",
            "failed",
            "cancelled",
            "job_type_str",
            "job_type",
            "started_by",
            "progress_current",
            "progress_target",
            "progress_step",
            "result",
            "id",
        )
        # Workers write jobs; the API only reports them.
        read_only_fields = fields

    def get_job_type_str(self, obj: LongRunningJob) -> str:
        return dict(LongRunningJob.JOB_TYPES)[obj.job_type]


class CancelJobResponseSerializer(serializers.Serializer[None]):
    """The answer of POST /api/jobs/{id}/cancel/: the cancelled job, nested."""

    status = serializers.BooleanField()
    job = LongRunningJobSerializer()


class JobListQuery(serializers.Serializer[None]):
    mine = QueryFlagField(
        true_values={"true"},
        help_text="true narrows a staff member's list to their own jobs",
    )


class GenerateOcrRequest(serializers.Serializer[None]):
    full_scan = serializers.BooleanField(
        default=False, help_text="Read text again on photos that have it"
    )
