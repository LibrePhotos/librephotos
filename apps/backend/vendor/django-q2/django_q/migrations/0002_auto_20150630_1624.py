from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("django_q", "0001_initial"),
    ]

    operations = [
        migrations.AlterField(
            model_name="schedule",
            name="args",
            field=models.TextField(
                help_text="e.g. 1, 2, 'John'", blank=True, null=True
            ),
        ),
        migrations.AlterField(
            model_name="schedule",
            name="kwargs",
            field=models.TextField(
                help_text="e.g. x=1, y=2, name='John'", blank=True, null=True
            ),
        ),
    ]
