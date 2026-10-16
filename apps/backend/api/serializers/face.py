from rest_framework import serializers

from api.drf.params import QueryFlagField, required_string
from api.models import Face, Person
from api.photos.library_files import MAX_REQUESTED
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


# A person's kind: KindEnum in the schema (ENUM_NAME_OVERRIDES), so the name stays
# when another "kind" choice appears.
PERSON_KINDS = Person.KIND_CHOICES


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
    deleted = QueryFlagField(
        true_values={"true"},
        help_text="true lists the person's deleted faces (person 0: deleted faces "
        "of no one); inferred and analysis_method are ignored then",
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
    deleted = QueryFlagField(
        true_values={"true"},
        help_text="true counts each person's deleted faces instead",
    )
    group = serializers.IntegerField(
        required=False,
        min_value=1,
        help_text="Only the people in this group of yours (#1126); the "
        "Unknown - Other entry still comes last",
    )


class ScanFacesRequest(serializers.Serializer[None]):
    """``POST /api/scanfaces``: where to detect faces again (#524).

    Neither field: every photo of the requester's. One of them narrows the
    run to a folder or to some photos; both at once is a 400.
    """

    photo_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        min_length=1,
        max_length=MAX_REQUESTED,
        help_text="Only these photos of the requester's",
    )
    path = serializers.CharField(
        required=False,
        trim_whitespace=False,
        help_text="Only the photos with a file in this folder or below it, "
        "inside the requester's scan directory or upload folder",
    )

    def validate(self, attrs: dict[str, object]) -> dict[str, object]:
        if "photo_ids" in attrs and "path" in attrs:
            raise serializers.ValidationError(
                "Give photo_ids or path, not both.", code="photo_ids_or_path"
            )
        return attrs


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


class FaceLabels(serializers.Serializer[None]):
    """A face's people: the one it is labelled with and the two suggested ones."""

    id = serializers.IntegerField(help_text="The face's id")
    person = serializers.IntegerField(
        allow_null=True, help_text="The person the face is labelled with"
    )
    cluster_person = serializers.IntegerField(
        allow_null=True, help_text="The person face clustering suggests"
    )
    classification_person = serializers.IntegerField(
        allow_null=True, help_text="The person the face classifier suggests"
    )


class SetFacePersonLabelResponse(serializers.Serializer[None]):
    """The answer of POST /api/labelfaces: the relabelled faces."""

    status = serializers.BooleanField()
    results = FaceListSerializer(many=True)
    updated = FaceListSerializer(many=True)
    not_updated = FaceListSerializer(many=True)
    previous = FaceLabels(
        many=True,
        help_text=(
            "Each relabelled face's people before this request; POST them to "
            "/api/restore-face-labels/ to undo it"
        ),
    )
    write_error = serializers.CharField(
        allow_null=True,
        help_text=(
            "Why the edit, saved in LibrePhotos, was not written to the file or "
            "its sidecar; null when it was written or writing is off (#2294)"
        ),
    )


class RestoreFaceLabelsRequest(serializers.Serializer[None]):
    """POST /api/restore-face-labels/: the ``previous`` of a labelling to undo."""

    faces = FaceLabels(many=True)


class RestoreFacesResponse(serializers.Serializer[None]):
    """The answer of POST /api/restore-faces/ and /api/restore-face-labels/."""

    restored_ids = serializers.ListField(
        child=serializers.IntegerField(),
        help_text="The faces restored; a face the requester does not own is skipped",
    )
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
