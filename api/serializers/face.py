from rest_framework import serializers

from api.models import Face


class FaceListSerializer(serializers.ModelSerializer):
    person_name = serializers.SerializerMethodField()
    face_url = serializers.SerializerMethodField()

    class Meta:
        model = Face
        fields = (
            "id",
            "image",
            "face_url",
            "photo",
            "person",
            "person_label_probability",
            "person_name",
        )

    def get_face_url(self, obj) -> str:
        return obj.image.url

    def get_person_name(self, obj) -> str:
        return obj.person.name
