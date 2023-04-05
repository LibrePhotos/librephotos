from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0003_remove_unused_thumbs"),
    ]

    operations = [
        migrations.AlterUniqueTogether(
            name="albumthing",
            unique_together=set([]),
        ),
        migrations.AddConstraint(
            model_name="albumthing",
            constraint=models.UniqueConstraint(
                fields=["title", "thing_type", "owner"],
                name="unique AlbumThing",
            ),
        ),
    ]
