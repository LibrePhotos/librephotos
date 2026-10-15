"""``Photo.archived``: the Archive state (#545).

An archived photo leaves the timeline and Memories but stays in albums,
people, places, folders and search. False for every existing photo.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0179_album_collections"),
    ]

    operations = [
        migrations.AddField(
            model_name="photo",
            name="archived",
            field=models.BooleanField(db_index=True, default=False),
        ),
    ]
