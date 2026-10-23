"""Sharing a person with other users, with a review of new photos (#668)."""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0212_album_comments'),
    ]

    operations = [
        migrations.AddField(
            model_name='person',
            name='first_shared_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='person',
            name='share_location',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='person',
            name='share_other_people',
            field=models.BooleanField(default=False),
        ),
        migrations.CreateModel(
            name='PersonShare',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('person', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='shares', to='api.person')),
                ('recipient', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='received_person_shares', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'unique_together': {('person', 'recipient')},
            },
        ),
        migrations.CreateModel(
            name='PersonSharePhoto',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('status', models.CharField(choices=[('approved', 'Approved'), ('declined', 'Declined')], max_length=10)),
                ('decided_at', models.DateTimeField(auto_now=True)),
                ('person', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='share_photos', to='api.person')),
                ('photo', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='person_share_photos', to='api.photo')),
            ],
            options={
                'unique_together': {('person', 'photo')},
            },
        ),
    ]
