from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("django_q", "0005_auto_20150718_1506"),
    ]

    operations = [
        migrations.AddField(
            model_name="schedule",
            name="minutes",
            field=models.PositiveSmallIntegerField(
                help_text="Number of minutes for the Minutes type",
                blank=True,
                null=True,
            ),
        ),
        migrations.AlterField(
            model_name="schedule",
            name="schedule_type",
            field=models.CharField(
                max_length=1,
                choices=[
                    ("O", "Once"),
                    ("I", "Minutes"),
                    ("H", "Hourly"),
                    ("D", "Daily"),
                    ("W", "Weekly"),
                    ("M", "Monthly"),
                    ("Q", "Quarterly"),
                    ("Y", "Yearly"),
                ],
                default="O",
                verbose_name="Schedule Type",
            ),
        ),
    ]
