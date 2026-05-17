from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("django_q", "0007_ormq"),
    ]

    operations = [
        migrations.AlterField(
            model_name="schedule",
            name="name",
            field=models.CharField(blank=True, max_length=100, null=True),
        ),
    ]
