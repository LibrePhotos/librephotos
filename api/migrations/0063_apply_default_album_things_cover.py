from django.db import migrations


class Migration(migrations.Migration):
    def apply_default(apps, schema_editor):
        AlbumThing = apps.get_model("api", "AlbumThing")

        for thing in AlbumThing.objects.all():
            if thing.photos.count() > 0:
                thing.cover_photos.add(*thing.photos.all()[:4])
                thing.save()

    def remove_default(apps, schema_editor):
        AlbumThing = apps.get_model("api", "AlbumThing")
        for thing in AlbumThing.objects.all():
            thing.cover_photos = None
            thing.save()

    dependencies = [
        ("api", "0062_albumthing_cover_photos"),
    ]

    operations = [migrations.RunPython(apply_default, remove_default)]
