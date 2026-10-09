from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0147_user_default_timeline_filter"),
    ]

    operations = [
        migrations.AddField(
            model_name="albumuser",
            name="locked",
            field=models.BooleanField(default=False),
        ),
    ]
