from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0122_merge_0121_add_default_tagging_model_0121_user_save_face_tags_to_disk"),
    ]

    operations = [
        migrations.AddField(
            model_name="longrunningjob",
            name="cancelled",
            field=models.BooleanField(default=False),
        ),
    ]
