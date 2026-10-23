"""Whether a user's public photos are in the public gallery (#434)."""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0216_photo_rights'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='in_public_gallery',
            field=models.BooleanField(default=False),
        ),
    ]
