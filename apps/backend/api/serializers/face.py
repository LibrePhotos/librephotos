from rest_framework import serializers

from api.models import Face, Person


class PersonFaceListSerializer(serializers.ModelSerializer):
    face_url = serializers.SerializerMethodField()
    person_label_probability = serializers.SerializerMethodField()

    class Meta:
        model = Face
        fields = [
            "id",
            "image",
            "face_url",
            "photo",
            "timestamp",
            "person_label_probability",
        ]

    def get_person_label_probability(self, obj):
        if obj.analysis_method == "clustering":
            return obj.cluster_probability
        else:
            return obj.classification_probability

    def get_face_url(self, obj):
        return obj.image.url


class IncompletePersonFaceListSerializer(serializers.ModelSerializer):
    face_count = serializers.SerializerMethodField()

    class Meta:
        model = Person
        fields = ["id", "name", "kind", "face_count"]

    def get_face_count(self, obj) -> int:
        if obj and obj.viewable_face_count:
            return obj.viewable_face_count
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

    def get_person_label_probability(self, obj) -> float:
        return obj.cluster_probability

    def get_face_url(self, obj) -> str:
        return obj.image.url

    def get_person_name(self, obj) -> str:
        if obj.person:
            return obj.person.name
        else:
            return "Unknown - Other"
