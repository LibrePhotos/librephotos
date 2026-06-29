from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0127_migrate_photon_provider_robustly"),
    ]

    operations = [
        migrations.AddField(
            model_name="user",
            name="scrub_face_region_tags_on_delete",
            field=models.BooleanField(default=False),
        ),
    ]
