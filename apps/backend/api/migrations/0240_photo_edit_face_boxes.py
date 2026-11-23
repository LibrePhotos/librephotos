from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0239_photo_edit"),
    ]

    operations = [
        migrations.AddField(
            model_name="photoedit",
            name="face_boxes",
            field=models.JSONField(default=dict),
        ),
    ]
