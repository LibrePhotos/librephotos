from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("django_q", "0006_auto_20150805_1817"),
    ]

    operations = [
        migrations.CreateModel(
            name="OrmQ",
            fields=[
                (
                    "id",
                    models.AutoField(
                        primary_key=True,
                        auto_created=True,
                        verbose_name="ID",
                        serialize=False,
                    ),
                ),
                ("key", models.CharField(max_length=100)),
                ("payload", models.TextField()),
                ("lock", models.DateTimeField(null=True)),
            ],
            options={
                "verbose_name_plural": "Queued tasks",
                "verbose_name": "Queued task",
            },
        ),
    ]
