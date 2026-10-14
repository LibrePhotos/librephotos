from rest_framework import serializers

from api.drf.params import QueryFlagField, required_string
from api.models import Face, Person
from api.serializers.fields import declare_fields


class PersonFaceListSerializer(serializers.ModelSerializer):
    face_url = serializers.SerializerMethodField()
    person_label_probability = serializers.SerializerMethodField()
    photo_image_hash = serializers.SerializerMethodField()

    class Meta:
        model = Face
        fields = [
            "id",
            "image",
            "face_url",
            "photo",
            "photo_image_hash",
            "timestamp",
            "person_label_probability",
        ]
        read_only_fields = ["photo"]

    def get_person_label_probability(self, obj: Face) -> float:
        # analysis_method is annotated by FaceListView's queryset; not a model field.
        if getattr(obj, "analysis_method") == "clustering":
            return obj.cluster_probability
        else:
            return obj.classification_probability

    def get_face_url(self, obj: Face) -> str | None:
        return obj.crop_url

    def get_photo_image_hash(self, obj: Face) -> str | None:
        return obj.photo.image_hash if obj.photo else None


class IncompletePersonFaceListSerializer(serializers.ModelSerializer):
    face_count = serializers.SerializerMethodField()

    class Meta:
        model = Person
        fields = ["id", "name", "kind", "face_count"]

    def get_face_count(self, obj: Person) -> int:
        # viewable_face_count is annotated by FaceIncompleteListViewSet's queryset.
        count: int = getattr(obj, "viewable_face_count")
        if count:
            return count
        else:
            return 0


class FaceListSerializer(serializers.ModelSerializer):
    person_name = serializers.SerializerMethodField()
    face_url = serializers.SerializerMethodField()
    person_label_probability = serializers.SerializerMethodField()

    class Meta:
        model = Face
        fields = (
            "id",
            "image",
            "face_url",
            "photo",
            "timestamp",
            "person",
            "person_label_probability",
            "person_name",
        )
        read_only_fields = ("photo", "person")

    def get_person_label_probability(self, obj: Face) -> float:
        return obj.cluster_probability

    def get_face_url(self, obj: Face) -> str | None:
        return obj.crop_url

    def get_person_name(self, obj: Face) -> str:
        if obj.person:
            return obj.person.name
        else:
            return "Unknown - Other"


class FaceListQuery(serializers.Serializer[None]):
    person = serializers.IntegerField(
        default=0, help_text="Person id; 0 lists the faces of no one"
    )
    analysis_method = serializers.CharField(
        default="clustering",
        allow_blank=True,
        help_text="clustering or classification; blank lists confirmed faces",
    )
    min_confidence = serializers.FloatField(default=0)
    inferred = QueryFlagField(
        false_values={"false"},
        help_text="false lists the person's confirmed faces only",
    )
    order_by = serializers.CharField(
        default="", allow_blank=True, help_text="date sorts by photo date first"
    )


class FaceIncompleteListQuery(serializers.Serializer[None]):
    inferred = QueryFlagField(
        true_values={"true"}, help_text="true counts suggested faces too"
    )
    analysis_method = serializers.CharField(
        default="clustering",
        allow_blank=True,
        help_text="clustering or classification, with inferred",
    )
    min_confidence = serializers.FloatField(default=0)


class FaceIdsRequest(serializers.Serializer[None]):
    face_ids = serializers.ListField(child=serializers.IntegerField())


class DeleteFacesResponse(serializers.Serializer[None]):
    """The answer of POST /api/deletefaces: the faces deleted."""

    status = serializers.BooleanField(help_text="Always true")
    deleted_ids = serializers.ListField(
        child=serializers.IntegerField(), help_text="The ids of the deleted faces"
    )
    deleted = serializers.ListField(
        child=serializers.CharField(),
        help_text="The crop URLs of the deleted faces; a face without a crop "
        "is only in deleted_ids",
    )
    results = serializers.ListField(
        child=serializers.CharField(), help_text="The same as deleted"
    )
    not_deleted = serializers.ListField(
        child=serializers.CharField(),
        help_text="Always []: a face the requester does not own is skipped",
    )


class SetFacePersonLabelRequest(FaceIdsRequest):
    # Trimmed and never blank: get_or_create() would make a nameless person.
    person_name = required_string("person_name must not be empty")


class SetFacePersonLabelResponse(serializers.Serializer[None]):
    """The answer of POST /api/labelfaces: the relabelled faces."""

    status = serializers.BooleanField()
    results = FaceListSerializer(many=True)
    updated = FaceListSerializer(many=True)
    not_updated = FaceListSerializer(many=True)
    write_error = serializers.CharField(
        allow_null=True,
        help_text=(
            "Why the edit, saved in LibrePhotos, was not written to the file or "
            "its sidecar; null when it was written or writing is off (#2294)"
        ),
    )


class AddFaceRequest(serializers.Serializer[None]):
    person_name = required_string("person_name must not be empty")
    photo = required_string(
        "photo is required", help_text="The photo's id or image_hash"
    )
    box = serializers.JSONField(
        required=False,
        help_text="top, right, bottom and left as fractions of the displayed image",
    )


class FaceBoxPixels(serializers.Serializer[None]):
    """A face box in big-thumbnail pixels."""

    top = serializers.IntegerField()
    right = serializers.IntegerField()
    bottom = serializers.IntegerField()
    left = serializers.IntegerField()


class AddedFace(serializers.Serializer[None]):
    face_id = serializers.IntegerField()
    face_url = serializers.CharField()
    person = serializers.IntegerField()
    person_name = serializers.CharField()
    location = FaceBoxPixels()


class AddFaceResponse(serializers.Serializer[None]):
    """The answer of POST /api/addface (201): the face drawn by hand."""

    status = serializers.BooleanField()
    write_error = serializers.CharField(
        allow_null=True,
        help_text=(
            "Why the edit, saved in LibrePhotos, was not written to the file or "
            "its sidecar; null when it was written or writing is off (#2294)"
        ),
    )
    face = AddedFace()


class ClusterFacePosition(serializers.Serializer[None]):
    """A face's encoding projected onto three axes (PCA)."""

    x = serializers.FloatField()
    y = serializers.FloatField()
    size = serializers.FloatField()


class ClusterFacePoint(serializers.Serializer[None]):
    """One face on the face cluster chart (``api.faces.classify.build_scatter_point``)."""

    person_id = serializers.IntegerField(help_text="-1 for a face without a person")
    person_name = serializers.CharField(help_text='"unknown" without a person')
    person_label_is_inferred = serializers.BooleanField(
        help_text="True when the face has no person"
    )
    color = serializers.CharField(help_text="The person's colour, #rrggbb")
    face_url = serializers.CharField()
    value = ClusterFacePosition()


class ClusterFacesResponse(serializers.Serializer[None]):
    """The answer of /api/clusterfaces: every face with an encoding, on the chart."""

    status = serializers.BooleanField()


declare_fields(ClusterFacesResponse, data=ClusterFacePoint(many=True))
