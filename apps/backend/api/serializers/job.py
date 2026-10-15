from django.db.models import Prefetch
from rest_framework import serializers

from api.drf.params import QueryFlagField
from api.models import LongRunningJob, User
from api.models.long_running_job import LongRunningJobQuerySet
from api.serializers.fields import loaded
from api.serializers.simple import SimpleUserSerializer


def with_job_relations(queryset: LongRunningJobQuerySet) -> LongRunningJobQuerySet:
    """What ``LongRunningJobSerializer`` reads: the starter and the baseline flag."""
    return queryset.with_scan_baseline_flag().prefetch_related(
        Prefetch(
            "started_by",
            queryset=User.objects.only("id", "username", "first_name", "last_name"),
        ),
    )


class LongRunningJobSerializer(serializers.ModelSerializer):
    job_type_str = serializers.SerializerMethodField()
    started_by = SimpleUserSerializer(read_only=True)
    is_scan_baseline = serializers.SerializerMethodField(
        help_text="The starter's newest complete library scan: the next incremental "
        "scan only rereads files changed since it, so it cannot be removed"
    )

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
            "is_scan_baseline",
            "id",
        )
        # Workers write jobs; the API only reports them.
        read_only_fields = fields

    def get_job_type_str(self, obj: LongRunningJob) -> str:
        return dict(LongRunningJob.JOB_TYPES)[obj.job_type]

    def get_is_scan_baseline(self, obj: LongRunningJob) -> bool:
        return bool(loaded(obj, "is_scan_baseline"))


class CancelJobResponseSerializer(serializers.Serializer[None]):
    """The answer of POST /api/jobs/{id}/cancel/: the cancelled job, nested."""

    status = serializers.BooleanField()
    job = LongRunningJobSerializer()


class JobStartedResponseSerializer(serializers.Serializer[None]):
    """The answer of a view that starts a job (``api.jobs.start.start_jobs``)."""

    status = serializers.BooleanField()
    job_id = serializers.CharField(help_text="The started job's id (its last step's)")
    job_ids = serializers.ListField(
        child=serializers.CharField(), help_text="Every step's job id, in order"
    )


class QueueAvailabilitySerializer(serializers.Serializer[None]):
    """``GET /api/rqavailable/``: whether the job queue is free."""

    status = serializers.BooleanField(help_text="Always true")
    queue_can_accept_job = serializers.BooleanField(
        help_text="False while a job runs or waits"
    )
    job_detail = LongRunningJobSerializer(
        allow_null=True,
        help_text="The running (else oldest queued) job; null when there is none "
        "or the requester neither started it nor is staff",
    )


class JobListQuery(serializers.Serializer[None]):
    mine = QueryFlagField(
        true_values={"true"},
        help_text="true narrows a staff member's list to their own jobs",
    )


class GenerateOcrRequest(serializers.Serializer[None]):
    full_scan = serializers.BooleanField(
        default=False, help_text="Read text again on photos that have it"
    )


class GenerateCaptionsRequest(serializers.Serializer[None]):
    full_scan = serializers.BooleanField(
        default=False,
        help_text="Caption again the photos that have a generated caption",
    )


class CaptionsJobStartedResponseSerializer(JobStartedResponseSerializer):
    """``POST /api/generate-captions/``: the started job, and whether it waits for the model."""

    downloads_model = serializers.BooleanField(
        help_text="The captioning model is downloaded first: the job starts after it"
    )
