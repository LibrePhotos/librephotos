from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0014_add_save_metadata_to_disk"),
    ]
    operations = [
        migrations.AddField(
            model_name="Photo",
            name="dominant_color",
            field=models.TextField(blank=True, null=True),
        ),
    ]
