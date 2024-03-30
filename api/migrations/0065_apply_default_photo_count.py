from django.db import migrations


class Migration(migrations.Migration):
    def apply_default(apps, schema_editor):
        AlbumThing = apps.get_model("api", "AlbumThing")

        for thing in AlbumThing.objects.all():
            thing.photo_count = thing.photos.filter(hidden=False).count()
            thing.save()

    def remove_default(apps, schema_editor):
        AlbumThing = apps.get_model("api", "AlbumThing")
        for thing in AlbumThing.objects.all():
            thing.photo_count = 0
            thing.save()

    dependencies = [
        ("api", "0064_albumthing_photo_count"),
    ]

    operations = [migrations.RunPython(apply_default, remove_default)]
