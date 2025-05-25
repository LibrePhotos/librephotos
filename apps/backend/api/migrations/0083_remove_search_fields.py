# Generated migration to remove search fields from Photo and PhotoCaption models

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0082_create_photo_search'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='photo',
            name='search_location',
        ),
        migrations.RemoveField(
            model_name='photocaption',
            name='search_captions',
        ),
    ] 