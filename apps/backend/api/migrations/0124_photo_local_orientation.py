from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0123_longrunningjob_cancelled"),
    ]

    operations = [
        migrations.AddField(
            model_name="photo",
            name="local_orientation",
            field=models.IntegerField(default=1),
        ),
    ]
