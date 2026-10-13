"""What the server says about itself (``api/views/server_info.py`` and the admin
views of ``api/views/dataviz.py``): the request input of the log viewer, and the
answers, which the views build as dicts. The answer serializers only describe
them for the OpenAPI schema.
"""

from typing import Any

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from api.drf.openapi import INTEGER_OR_EMPTY_STRING
from api.drf.params import ClampedIntegerField


class ServerLogsQuery(serializers.Serializer[None]):
    lines = ClampedIntegerField(
        default=100,
        lowest=1,
        highest=1000,
        help_text="Lines from the end of the log (1 to 1000)",
    )


class ServerLogsSerializer(serializers.Serializer[None]):
    """``GET /api/serverlogs/view``: the last lines of the server log."""

    logs = serializers.CharField(help_text="The lines, joined")
    count = serializers.IntegerField(help_text="How many lines logs holds")


class StorageStatsSerializer(serializers.Serializer[None]):
    """``GET /api/storagestats/``: the disk that holds the data directory, in bytes."""

    total_storage = serializers.IntegerField()
    used_storage = serializers.IntegerField()
    free_storage = serializers.IntegerField()


class ImageTagSerializer(serializers.Serializer[None]):
    """``GET /api/imagetag/``: the build the server runs."""

    image_tag = serializers.CharField(help_text="IMAGE_TAG; empty when unset")
    git_hash = serializers.CharField(
        help_text="GIT_HASH, else the checkout's commit, else image_tag or unknown"
    )


class ApiHelpJwtSerializer(serializers.Serializer[None]):
    obtain = serializers.CharField()
    refresh = serializers.CharField()
    how_to = serializers.CharField()


class ApiHelpBasicSerializer(serializers.Serializer[None]):
    how_to = serializers.CharField()


class ApiHelpAuthenticationSerializer(serializers.Serializer[None]):
    default_authentication_classes = serializers.ListField(
        child=serializers.CharField()
    )
    jwt = ApiHelpJwtSerializer()
    basic = ApiHelpBasicSerializer()


class ApiHelpEndpointsSerializer(serializers.Serializer[None]):
    api_root = serializers.CharField()
    help = serializers.CharField()
    photos = serializers.CharField()
    search = serializers.CharField()
    openapi_schema = serializers.CharField(required=False, help_text="DEBUG only")
    swagger_ui = serializers.CharField(required=False, help_text="DEBUG only")
    redoc = serializers.CharField(required=False, help_text="DEBUG only")


class ApiHelpDocumentationSerializer(serializers.Serializer[None]):
    api_authentication = serializers.CharField()


class ApiHelpExamplesSerializer(serializers.Serializer[None]):
    obtain_token_curl = serializers.CharField()
    call_api_with_bearer = serializers.CharField()
    call_api_with_basic = serializers.CharField()


class ApiHelpSerializer(serializers.Serializer[None]):
    """``GET /api/help``: how to sign in to the API, with absolute URLs."""

    about = serializers.CharField()
    authentication = ApiHelpAuthenticationSerializer()
    useful_endpoints = ApiHelpEndpointsSerializer()
    documentation = ApiHelpDocumentationSerializer()
    examples = ApiHelpExamplesSerializer()


class CpuInfoSerializer(serializers.Serializer[None]):
    """py-cpuinfo's ``get_cpu_info()`` with numeric cache sizes
    (``api.dataviz.stats._get_cpu_info``).

    Only the first seven keys are always there: py-cpuinfo drops every key it
    cannot read, or reads as empty or 0.
    """

    python_version = serializers.CharField()
    cpuinfo_version = serializers.ListField(child=serializers.IntegerField())
    cpuinfo_version_string = serializers.CharField()
    arch = serializers.CharField()
    bits = serializers.IntegerField()
    count = serializers.IntegerField()
    arch_string_raw = serializers.CharField()
    vendor_id_raw = serializers.CharField(required=False)
    hardware_raw = serializers.CharField(required=False)
    brand_raw = serializers.CharField(required=False)
    uname_string_raw = serializers.CharField(required=False)
    processor_type = serializers.CharField(required=False)
    hz_advertised_friendly = serializers.CharField(required=False)
    hz_actual_friendly = serializers.CharField(required=False)
    hz_advertised = serializers.ListField(
        child=serializers.IntegerField(), required=False
    )
    hz_actual = serializers.ListField(child=serializers.IntegerField(), required=False)
    stepping = serializers.IntegerField(required=False)
    model = serializers.IntegerField(required=False)
    family = serializers.IntegerField(required=False)
    flags = serializers.ListField(child=serializers.CharField(), required=False)
    l3_cache_size = serializers.IntegerField(required=False, help_text="Bytes")
    l2_cache_size = serializers.IntegerField(required=False, help_text="Bytes")
    l1_data_cache_size = serializers.IntegerField(required=False, help_text="Bytes")
    l1_instruction_cache_size = serializers.IntegerField(
        required=False, help_text="Bytes"
    )
    l2_cache_line_size = serializers.IntegerField(required=False)
    l2_cache_associativity = serializers.IntegerField(required=False)


class GroupStatsSerializer(serializers.Serializer[None]):
    """How many groups there are and their members per group: photos per
    album, faces per person (``api.dataviz.stats._aggregate_stats``).

    min, max and mean are null when there is no group or every group is
    empty; median is null only when there is no group.
    """

    count = serializers.IntegerField()
    min = serializers.IntegerField(allow_null=True)
    max = serializers.IntegerField(allow_null=True)
    mean = serializers.FloatField(allow_null=True)
    median = serializers.FloatField(allow_null=True)


class PhotoGroupStatsSerializer(GroupStatsSerializer):
    """``GroupStats`` of photos per album, plus the same over videos only
    (``api.dataviz.stats._photo_group_stats``)."""

    min_videos = serializers.IntegerField(allow_null=True)
    max_videos = serializers.IntegerField(allow_null=True)
    mean_videos = serializers.FloatField(allow_null=True)
    median_videos = serializers.FloatField(allow_null=True)


class UserStatsSerializer(serializers.Serializer[None]):
    """One user's library (``api.dataviz.stats._get_user_stats``)."""

    date_joined = serializers.CharField(help_text="DD-MM-YYYY")
    total_file_size_in_mb = serializers.IntegerField()
    number_of_photos = serializers.IntegerField()
    number_of_videos = serializers.IntegerField()
    number_of_screenshots = serializers.IntegerField()
    number_of_documents = serializers.IntegerField()
    number_of_captions = serializers.IntegerField()
    number_of_generated_captions = serializers.IntegerField()
    album = PhotoGroupStatsSerializer()
    person = GroupStatsSerializer(help_text="Faces per person")
    number_of_clusters = serializers.IntegerField()
    places = PhotoGroupStatsSerializer()
    things = PhotoGroupStatsSerializer()
    events = PhotoGroupStatsSerializer()
    number_of_favorites = serializers.IntegerField()
    number_of_hidden = serializers.IntegerField()
    number_of_public = serializers.IntegerField()


@extend_schema_field(INTEGER_OR_EMPTY_STRING)
class GpuMemoryField(serializers.Field[Any, Any, Any, Any]):
    """The GPU's memory in MB, or "" when nvidia-smi reports none."""


class ServerStatsSerializer(serializers.Serializer[None]):
    """``GET /api/serverstats/`` (``api.dataviz.stats.get_server_stats``)."""

    cpu_info = CpuInfoSerializer()
    image_tag = serializers.CharField()
    available_ram_in_mb = serializers.IntegerField()
    gpu_name = serializers.CharField(help_text="Empty when there is no NVIDIA GPU")
    gpu_memory_in_mb = GpuMemoryField()
    total_storage_in_mb = serializers.IntegerField()
    used_storage_in_mb = serializers.IntegerField()
    free_storage_in_mb = serializers.IntegerField()
    number_of_users = serializers.IntegerField()
    users = UserStatsSerializer(many=True)
