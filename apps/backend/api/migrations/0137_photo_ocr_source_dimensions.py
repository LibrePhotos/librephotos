from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0136_stackreview_monotonic_pk"),
    ]

    operations = [
        migrations.AddField(
            model_name="photoocr",
            name="source_width",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name="photoocr",
            name="source_height",
            field=models.PositiveIntegerField(blank=True, null=True),
        ),
    ]
