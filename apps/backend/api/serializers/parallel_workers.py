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
    web_mb = serializers.IntegerField(help_text="Budgeted for the web server.")
    sidecars_mb = serializers.IntegerField(
        help_text="Budgeted for the enabled sidecars other than face recognition."
    )
    face_replicas = serializers.IntegerField(
        help_text="Face services (one per heavy worker at most); 0 when face "
        "recognition is off."
    )
    face_replica_mb = serializers.IntegerField(
        help_text="Memory budgeted per face service."
    )
    face_vram_mb = serializers.IntegerField(
        help_text="GPU memory budgeted per face service; 0 on the CPU."
    )
    face_device = serializers.CharField(help_text="cpu, gpu or unknown")
    face_limited_by = serializers.CharField(
        help_text="lanes, memory, vram, gpu, setting, maximum or off"
    )
    vram_budget_mb = serializers.IntegerField(
        allow_null=True,
        help_text="GPU memory the face services may use; null when unknown.",
    )


class RunningWorkerSerializer(serializers.Serializer[None]):
    name = serializers.CharField()
    slot = serializers.IntegerField()
    active = serializers.BooleanField()
    rss_mb = serializers.IntegerField()
    heartbeat_at = serializers.DateTimeField()
    memory_recycles = serializers.IntegerField()
    last_recycle = serializers.CharField()


class FaceServicesSerializer(serializers.Serializer[None]):
    running = serializers.IntegerField(help_text="Face service processes running.")
    live = serializers.IntegerField(help_text="Face services taking requests.")
    device = serializers.CharField(
        allow_null=True, help_text="cpu, webgpu or cuda once a model is loaded."
    )
    rss_mb = serializers.ListField(child=serializers.IntegerField())
    gpu_total_mb = serializers.IntegerField(allow_null=True)
    gpu_free_mb = serializers.IntegerField(allow_null=True)


class ParallelWorkersSerializer(serializers.Serializer[dict[str, object]]):
    capacity = CapacitySerializer()
    intention = serializers.CharField(help_text="gentle, balanced or fast")
    override = serializers.IntegerField(
        allow_null=True,
        help_text="WORKER_CONCURRENCY when it is set; it wins over the intention.",
    )
    face_override = serializers.IntegerField(
        allow_null=True,
        help_text="FACE_SIDECAR_REPLICAS when it is set; the plan still caps it.",
    )
    plans = WorkerPlanSerializer(many=True)
    workers = RunningWorkerSerializer(many=True)
    face_services = FaceServicesSerializer()


class ParallelWorkersRequest(serializers.Serializer[None]):
    intention = serializers.ChoiceField(choices=INTENTIONS)
