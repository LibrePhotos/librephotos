"""The town of each photo's place, for the public gallery's places (#434).

``Photo.town`` holds ``town_name(geolocation_json)``, so the gallery groups
and filters by town in SQL instead of reading every photo's place. Filled
here for the photos that already have a place; ``Photo.save`` keeps it.
"""

from django.db import migrations, models

from api.models.place_names import town_name

BATCH = 1000
MAX_LENGTH = 200


def fill_towns(apps, schema_editor):
    Photo = apps.get_model("api", "Photo")
    photos = (
        Photo.objects.filter(geolocation_json__isnull=False)
        .only("pk", "geolocation_json")
        .iterator(chunk_size=BATCH)
    )
    batch = []
    for photo in photos:
        town = (town_name(photo.geolocation_json) or "")[:MAX_LENGTH]
        if town:
            photo.town = town
            batch.append(photo)
        if len(batch) >= BATCH:
            Photo.objects.bulk_update(batch, ["town"])
            batch = []
    if batch:
        Photo.objects.bulk_update(batch, ["town"])


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0217_user_in_public_gallery'),
    ]

    operations = [
        migrations.AddField(
            model_name='photo',
            name='town',
            field=models.CharField(blank=True, db_index=True, default='', max_length=200),
        ),
        migrations.RunPython(fill_towns, migrations.RunPython.noop),
    ]
