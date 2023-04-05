from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0004_fix_album_thing_constraint"),
    ]

    operations = [
        migrations.AddField(
            model_name="Photo", name="video", field=models.BooleanField(default=False)
        )
    ]
