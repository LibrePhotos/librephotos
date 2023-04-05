from django.db import migrations


class Migration(migrations.Migration):
    def apply_enum(apps, schema_editor):
        Person = apps.get_model("api", "Person")
        for person in Person.objects.filter(kind="").all():
            person.kind = "USER"
            person.save()

    def remove_enum(apps, schema_editor):
        Person = apps.get_model("api", "Person")
        for person in Person.objects.filter(kind="").all():
            person.kind = ""
            person.save()

    dependencies = [
        ("api", "0040_add_user_public_sharing_flag"),
    ]

    operations = [migrations.RunPython(apply_enum, remove_enum)]
