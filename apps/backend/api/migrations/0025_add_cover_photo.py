from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0024_photo_timestamp"),
    ]
    operations = [
        migrations.AddField(
            model_name="AlbumUser",
            name="cover_photo",
            field=models.ForeignKey(
                to="api.Photo",
                related_name="album_user",
                on_delete=models.PROTECT,
                blank=False,
                null=True,
            ),
        ),
    ]
