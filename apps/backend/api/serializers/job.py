from django.db.models import Prefetch
from rest_framework import serializers

from api.drf.params import QueryFlagField
from api.jobs.upgrade_tasks import TaskList, TaskOverview
from api.models import LongRunningJob, User
from api.models.long_running_job import LongRunningJobQuerySet
from api.photos.library_files import MAX_REQUESTED
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


class FindThingsRequest(serializers.Serializer[None]):
    full_scan = serializers.BooleanField(
        default=False,
        help_text="Find things again in the photos that have them (#2765)",
    )


class CheckFileContentsRequest(serializers.Serializer[None]):
    """``POST /api/check-file-contents/``: whose files, and which folder of them."""

    user_id = serializers.IntegerField(
        required=False,
        allow_null=True,
        default=None,
        help_text="Only this user's library; every user's when left out",
    )
    folder = serializers.CharField(
        required=False,
        allow_blank=True,
        default="",
        help_text="Only this folder, relative to the user's scan directory; needs user_id",
    )


class CaptionsJobStartedResponseSerializer(JobStartedResponseSerializer):
    """``POST /api/generate-captions/``: the started job, and whether it waits for the model."""

    downloads_model = serializers.BooleanField(
        help_text="The captioning model is downloaded first: the job starts after it"
    )


class UpgradeTaskSerializer(serializers.Serializer[TaskOverview]):
    """One row of the Admin page's Finish the upgrade card (``api.jobs.upgrade_tasks``)."""

    key = serializers.CharField(
        help_text="The task's name; the web app has its title and sentence"
    )
    kind = serializers.ChoiceField(
        choices=["automatic", "action"],
        help_text="automatic: runs by itself; action: waits for Start",
    )
    optional = serializers.BooleanField(
        help_text="An optional task may be dismissed; automatic ones are required"
    )
    status = serializers.ChoiceField(
        choices=["pending", "running", "failed", "done"],
        help_text="done: finished in the last day; failed: the last run failed "
        "or was cancelled; pending: work is left, and with a latest_job_id a run "
        "ended without doing all of it",
    )
    count = serializers.IntegerField(
        allow_null=True, help_text="How many items the task works on, when it says"
    )
    progress_current = serializers.IntegerField(
        allow_null=True, help_text="Items done by the running jobs; null when none runs"
    )
    progress_target = serializers.IntegerField(
        allow_null=True, help_text="Items of the running jobs; null when none runs"
    )
    latest_job_id = serializers.IntegerField(
        allow_null=True,
        help_text="The running job, else the last one since the task appeared "
        "(a job list id)",
    )
    error = serializers.CharField(
        allow_null=True, help_text="Why the last run failed, when it says"
    )
    completed_at = serializers.DateTimeField(
        allow_null=True, help_text="When the task stopped being needed"
    )


class UpgradeTaskListSerializer(serializers.Serializer[TaskList]):
    """``GET /api/upgrade-tasks/``: the tasks an upgrade left, done ones for a day."""

    tasks = UpgradeTaskSerializer(many=True)


class RescanPhotosRequest(serializers.Serializer[None]):
    """``POST /api/photos/rescan/``: the photos whose files to read again (#2214)."""

    photo_ids = serializers.ListField(
        child=serializers.UUIDField(),
        min_length=1,
        max_length=MAX_REQUESTED,
        help_text="Ids of the requester's photos; someone else's id is ignored",
    )


class RescanPhotosResponseSerializer(JobStartedResponseSerializer):
    """``POST /api/photos/rescan/``: the started scan and what it reads."""

    photo_count = serializers.IntegerField(
        help_text="The photos whose files are read again"
    )
    file_count = serializers.IntegerField(
        help_text="Their files: main files, variants and sidecars"
    )


class ScanFilesRequest(serializers.Serializer[None]):
    """``POST /api/scan-files/``: paths an outside process says are new, changed or gone.

    At least one of the lists must name a path. Two lists, so a typo in
    ``paths`` is never read as "forget this file" (#2728).
    """

    paths = serializers.ListField(
        child=serializers.CharField(trim_whitespace=False),
        required=False,
        default=list,
        max_length=MAX_REQUESTED,
        help_text="Absolute paths of new or changed files, or folders whose files "
        "to scan (#2727), in the requester's scan directory or upload folder, as "
        "the server sees them",
    )
    removed_paths = serializers.ListField(
        child=serializers.CharField(trim_whitespace=False),
        required=False,
        default=list,
        max_length=MAX_REQUESTED,
        help_text="Absolute paths of files, or folders, in the requester's "
        "library that were deleted or moved away: their files are detached from "
        "the requester's photos and flagged missing (#2728)",
    )

    def validate(self, attrs: dict[str, list[str]]) -> dict[str, list[str]]:
        if not attrs["paths"] and not attrs["removed_paths"]:
            raise serializers.ValidationError(
                {"paths": "Name a path in paths or removed_paths."}, code="min_length"
            )
        return attrs


class ScanFilesResponseSerializer(serializers.Serializer[None]):
    """``POST /api/scan-files/``: the started scan, the files detached, the paths left out."""

    status = serializers.BooleanField()
    job_id = serializers.CharField(
        allow_null=True,
        help_text="The started scan's id; null when paths named nothing to scan",
    )
    job_ids = serializers.ListField(
        child=serializers.CharField(), help_text="The started scan's id, or none"
    )
    file_count = serializers.IntegerField(
        help_text="The paths the scan looks at; a folder counts as one"
    )
    removed_count = serializers.IntegerField(
        help_text="The files of removed_paths detached and flagged missing"
    )
    ignored_paths = serializers.ListField(
        child=serializers.CharField(),
        help_text="Paths left out: outside the requester's library, repeats, "
        "paths that do not exist, removed paths still on disk or naming no file "
        "of the requester's photos",
    )
