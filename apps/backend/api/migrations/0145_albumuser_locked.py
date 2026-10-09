from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0144_sqlite_restore_foreign_keys"),
    ]

    operations = [
        migrations.AddField(
            model_name="albumuser",
            name="locked",
            field=models.BooleanField(default=False),
        ),
    ]
