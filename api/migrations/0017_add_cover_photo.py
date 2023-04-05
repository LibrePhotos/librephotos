from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0016_add_transcode_videos"),
    ]
    operations = [
        migrations.AddField(
            model_name="Person",
            name="cover_photo",
            field=models.ForeignKey(
                to="api.Photo",
                related_name="person",
                on_delete=models.PROTECT,
                blank=False,
                null=True,
            ),
        ),
    ]
