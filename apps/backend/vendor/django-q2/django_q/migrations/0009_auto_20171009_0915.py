from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("django_q", "0008_auto_20160224_1026"),
    ]

    operations = [
        migrations.AlterField(
            model_name="schedule",
            name="repeats",
            field=models.IntegerField(
                default=-1,
                help_text="n = n times, -1 = forever",
                verbose_name="Repeats",
            ),
        ),
    ]
