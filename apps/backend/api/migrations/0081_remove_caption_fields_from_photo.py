# Generated migration to remove caption fields from Photo model

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0080_create_photo_caption'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='photo',
            name='captions_json',
        ),
        migrations.RemoveField(
            model_name='photo',
            name='search_captions',
        ),
    ] 