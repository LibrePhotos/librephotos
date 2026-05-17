from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("django_q", "0003_auto_20150708_1326"),
    ]

    operations = [
        migrations.AlterModelOptions(
            name="failure",
            options={
                "verbose_name_plural": "Failed tasks",
                "verbose_name": "Failed task",
                "ordering": ["-stopped"],
            },
        ),
        migrations.AlterModelOptions(
            name="success",
            options={
                "verbose_name_plural": "Successful tasks",
                "verbose_name": "Successful task",
                "ordering": ["-stopped"],
            },
        ),
        migrations.AlterModelOptions(
            name="task",
            options={"ordering": ["-stopped"]},
        ),
    ]
