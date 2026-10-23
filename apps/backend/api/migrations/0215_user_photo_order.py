"""Newest or oldest day first in the date-grouped photo lists (#2712)."""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0214_user_scrubber_style'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='photo_order',
            field=models.TextField(choices=[('newest', 'Newest'), ('oldest', 'Oldest')], default='newest'),
        ),
    ]
