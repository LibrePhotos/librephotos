from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0045_alter_face_cluster"),
    ]

    operations = [
        migrations.AddField(
            model_name="file",
            name="embedded_media",
            field=models.ManyToManyField("File"),
        ),
    ]
