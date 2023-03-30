from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0041_apply_user_enum_for_person"),
    ]

    operations = [
        migrations.AddField(
            model_name="file",
            name="embedded_media",
            field=models.ManyToManyField("self", related_name="+"),
        ),
    ]
