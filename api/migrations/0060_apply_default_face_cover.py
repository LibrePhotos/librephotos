from django.db import migrations


class Migration(migrations.Migration):
    def apply_default(apps, schema_editor):
        Person = apps.get_model("api", "Person")

        for person in Person.objects.filter(kind="USER").all():
            if not person.cover_face and person.faces.count() > 0:
                person.cover_face = person.faces.first()
                person.save()
            if (
                not person.cover_face
                and person.cover_photo
                and person.cover_photo.faces.count() > 0
            ):
                person.cover_face = person.cover_photo.faces.filter(
                    person__name=person.name
                ).first()
                person.save()

    def remove_default(apps, schema_editor):
        Person = apps.get_model("api", "Person")
        for person in Person.objects.all():
            person.cover_face = None

    dependencies = [
        ("api", "0059_person_cover_face"),
    ]

    operations = [migrations.RunPython(apply_default, remove_default)]
