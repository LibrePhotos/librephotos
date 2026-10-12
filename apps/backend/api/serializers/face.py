from rest_framework import serializers

from api.drf.params import QueryFlagField, required_string
from api.models import Face, Person


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

    def get_face_url(self, obj: Face) -> str:
        return obj.image.url

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

    def get_face_url(self, obj: Face) -> str:
        return obj.image.url

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


class SetFacePersonLabelRequest(FaceIdsRequest):
    # Trimmed and never blank: get_or_create() would make a nameless person.
    person_name = required_string("person_name must not be empty")


class AddFaceRequest(serializers.Serializer[None]):
    person_name = required_string("person_name must not be empty")
    photo = required_string(
        "photo is required", help_text="The photo's id or image_hash"
    )
    box = serializers.JSONField(
        required=False,
        help_text="top, right, bottom and left as fractions of the displayed image",
    )
