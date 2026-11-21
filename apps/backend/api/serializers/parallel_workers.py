from rest_framework import serializers

from api.runtime.capacity import INTENTIONS


class CapacitySerializer(serializers.Serializer[None]):
    cores = serializers.IntegerField()
    cpu_source = serializers.CharField(
        help_text="host, affinity, cgroup v1 or cgroup v2"
    )
    ram_total_mb = serializers.IntegerField()
    ram_available_mb = serializers.IntegerField()
    ram_source = serializers.CharField(
        help_text="host, cgroup v1, cgroup v2 or job object"
    )


class WorkerPlanSerializer(serializers.Serializer[None]):
    intention = serializers.CharField()
    workers = serializers.IntegerField()
    heavy_workers = serializers.IntegerField()
    budget_mb = serializers.IntegerField()
    needed_mb = serializers.IntegerField()
    limited_by = serializers.CharField(
        help_text="intention, cores, memory, database or setting"
    )
    fits = serializers.BooleanField(
        help_text="Whether one worker fits in the memory budget."
    )


class RunningWorkerSerializer(serializers.Serializer[None]):
    name = serializers.CharField()
    slot = serializers.IntegerField()
    active = serializers.BooleanField()
    rss_mb = serializers.IntegerField()
    heartbeat_at = serializers.DateTimeField()
    memory_recycles = serializers.IntegerField()
    last_recycle = serializers.CharField()


class ParallelWorkersSerializer(serializers.Serializer[dict[str, object]]):
    capacity = CapacitySerializer()
    intention = serializers.CharField(help_text="gentle, balanced or fast")
    override = serializers.IntegerField(
        allow_null=True,
        help_text="WORKER_CONCURRENCY when it is set; it wins over the intention.",
    )
    plans = WorkerPlanSerializer(many=True)
    workers = RunningWorkerSerializer(many=True)


class ParallelWorkersRequest(serializers.Serializer[None]):
    intention = serializers.ChoiceField(choices=INTENTIONS)
