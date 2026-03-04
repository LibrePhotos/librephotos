from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0120_rename_thumbnails_uuid_to_hash"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="save_face_tags_to_disk",
            field=models.BooleanField(default=False),
        ),
    ]
