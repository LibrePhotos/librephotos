from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0043_alter_photo_size"),
    ]

    operations = [
        migrations.AddField(
            model_name="file",
            name="embedded_media",
            field=models.ManyToManyField("self", related_name="+"),
        ),
    ]
