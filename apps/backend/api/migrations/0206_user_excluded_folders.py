"""The folders a user left out of their library (#791)."""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0205_library_folder'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='excluded_folders',
            field=models.JSONField(blank=True, default=list),
        ),
    ]
