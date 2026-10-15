"""``PersonGroup``: a user's own grouping of their people (#1126).

A new table and the many-to-many ``Person.groups``; nothing existing changes.
"""

import django.db.models.deletion
import django.db.models.functions.text
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0180_photo_archived'),
    ]

    operations = [
        migrations.CreateModel(
            name='PersonGroup',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=128)),
                ('last_modified', models.DateTimeField(auto_now=True, db_index=True)),
                ('owner', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.AddField(
            model_name='person',
            name='groups',
            field=models.ManyToManyField(blank=True, related_name='persons', to='api.persongroup'),
        ),
        migrations.AddConstraint(
            model_name='persongroup',
            constraint=models.UniqueConstraint(django.db.models.functions.text.Lower('name'), models.F('owner'), name='unique_person_group_name'),
        ),
    ]
