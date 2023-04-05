from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0039_remove_photo_image_paths"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="public_sharing",
            field=models.BooleanField(default=False),
        ),
    ]
