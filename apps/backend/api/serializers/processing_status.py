"""The answers and requests of the library processing status (#2741)."""

from rest_framework import serializers

from api.jobs.processing_status import (
    STAGE_KEYS,
    LastRun,
    ProcessingStatus,
    RunningJob,
    StageStatus,
)

# The processing stages, in pipeline order (one OpenAPI enum).
PROCESSING_STAGES = list(STAGE_KEYS)


class ProcessingStageRunningJobSerializer(serializers.Serializer[RunningJob]):
    """The stage's job while it is queued or running."""

    job_id = serializers.CharField()
    progress_current = serializers.IntegerField()
    progress_target = serializers.IntegerField()


class ProcessingStageLastRunSerializer(serializers.Serializer[LastRun]):
    """The newest finished run of the stage's job the caller started."""

    job_id = serializers.CharField()
    finished_at = serializers.DateTimeField(allow_null=True)
    failed = serializers.BooleanField(help_text="The run failed as a whole")
    error_count = serializers.IntegerField(
        help_text="Items (photos, files, faces) the run could not process"
    )


class ProcessingStageSerializer(serializers.Serializer[StageStatus]):
    """One processing stage that is turned on."""

    key = serializers.ChoiceField(choices=PROCESSING_STAGES)
    remaining = serializers.IntegerField(
        help_text="What the stage still has to do: photos, or faces for "
        "face_recognition. Photos in the trash or whose file is gone are not counted"
    )
    unmatched = serializers.IntegerField(
        help_text="face_recognition: faces the face model found no face in, kept "
        "without recognition data and not counted in remaining until the model "
        "changes or they are tried again. 0 for the other stages"
    )
    running_job = ProcessingStageRunningJobSerializer(allow_null=True)
    last_run = ProcessingStageLastRunSerializer(allow_null=True)


class ProcessingStatusSerializer(serializers.Serializer[ProcessingStatus]):
    """``GET /api/library/processing-status/``: what is left per stage."""

    photo_count = serializers.IntegerField(
        help_text="The caller's photos, not counting removed or trashed ones"
    )
    stages = ProcessingStageSerializer(
        many=True,
        help_text="The stages that are turned on, in pipeline order; a stage "
        "that is off is left out",
    )


class RunProcessingStageRequest(serializers.Serializer[None]):
    """``POST /api/library/processing-status/run/``."""

    stage = serializers.ChoiceField(
        choices=PROCESSING_STAGES, help_text="The stage to catch up"
    )
