"""The scroll scrubber style a user picked for photo lists: thumb or density map."""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0213_person_shares'),
    ]

    operations = [
        migrations.AddField(
            model_name='user',
            name='scrubber_style',
            field=models.TextField(choices=[('thumb', 'Thumb'), ('density', 'Density')], default='thumb'),
        ),
    ]
