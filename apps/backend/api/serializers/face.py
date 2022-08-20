from rest_framework import serializers

from api.models import Face, Person
from api.serializers.person import PersonSerializer
from api.util import logger


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


class FaceSerializer(serializers.ModelSerializer):
    face_url = serializers.SerializerMethodField()
    person = PersonSerializer(many=False)

    class Meta:
        model = Face
        fields = (
            "id",
            "face_url",
            "photo_id",
            "person",
            "person_id",
            "person_label_is_inferred",
        )

    def get_face_url(self, obj) -> str:
        return obj.image.url

    def update(self, instance, validated_data):
        name = validated_data.pop("person")["name"]
        p = Person.objects.filter(name=name)
        if p.count() > 0:
            instance.person = p[0]
        else:
            p = Person()
            p.name = name
            p.save()
            instance.person = p
            logger.info("created person with name %s" % name)
        if (
            instance.person.name == "unknown"
            or instance.person.name == Person.UNKNOWN_PERSON_NAME
        ):
            instance.person_label_is_inferred = None
            instance.person_label_probability = 0.0
        else:
            instance.person_label_is_inferred = False
            instance.person_label_probability = 1.0
        logger.info(
            "updated label for face %d to %s" % (instance.id, instance.person.name)
        )
        instance.save()
        return instance
