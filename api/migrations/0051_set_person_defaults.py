from django.db import migrations


class Migration(migrations.Migration):
    def apply_default(apps, schema_editor):
        Person = apps.get_model("api", "Person")
        User = apps.get_model("api", "User")

        for person in Person.objects.filter(kind="USER").all():
            number_of_faces = person.faces.filter(
                photo__hidden=False,
                photo__deleted=False,
                photo__owner=person.cluster_owner.id,
            ).count()
            if not person.cover_photo and number_of_faces > 0:
                person.cover_photo = (
                    person.faces.filter(
                        photo__hidden=False,
                        photo__deleted=False,
                        photo__owner=person.cluster_owner.id,
                    )
                    .first()
                    .photo
                )
            confidence_person = (
                User.objects.filter(id=person.cluster_owner.id)
                .first()
                .confidence_person
            )
            person.face_count = person.faces.filter(
                photo__hidden=False,
                photo__deleted=False,
                photo__owner=person.cluster_owner.id,
                person_label_probability__gte=confidence_person,
            ).count()
            person.save()

    def remove_default(apps, schema_editor):
        Person = apps.get_model("api", "Person")
        for person in Person.objects.all():
            person.face_count = 0
            person.save()

    dependencies = [
        ("api", "0050_person_face_count"),
    ]

    operations = [migrations.RunPython(apply_default, remove_default)]
