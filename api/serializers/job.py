from rest_framework import serializers

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
            "job_type_str",
            "job_type",
            "started_by",
            "progress_current",
            "progress_target",
            "id",
        )

    def get_job_type_str(self, obj) -> str:
        return dict(LongRunningJob.JOB_TYPES)[obj.job_type]
