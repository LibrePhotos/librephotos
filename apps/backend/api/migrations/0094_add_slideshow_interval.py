# Generated manually for slideshow interval feature

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0093_migrate_photon_to_nominatim'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='slideshow_interval',
            field=models.IntegerField(default=5),
        ),
    ]

