from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0005_add_video_to_photo"),
    ]

    operations = [
        migrations.AlterField(
            model_name="Face",
            name="person_label_is_inferred",
            field=models.BooleanField(null=True, db_index=True),
        )
    ]
