"""UserPlace: the places a user names and draws as circles (#1365)."""

import django.db.models.deletion
import django.db.models.functions.text
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0208_face_video_time'),
    ]

    operations = [
        migrations.CreateModel(
            name='UserPlace',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=100)),
                ('icon', models.CharField(choices=[('pin', 'Pin'), ('home', 'Home'), ('work', 'Work'), ('school', 'School'), ('heart', 'Heart'), ('star', 'Star')], default='pin', max_length=16)),
                ('center_lat', models.FloatField()),
                ('center_lon', models.FloatField()),
                ('radius_m', models.PositiveIntegerField()),
                ('use_in_titles', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('last_modified', models.DateTimeField(auto_now=True, db_index=True)),
                ('owner', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, to=settings.AUTH_USER_MODEL)),
                ('photos', models.ManyToManyField(blank=True, related_name='user_places', to='api.photo')),
            ],
            options={
                'constraints': [models.UniqueConstraint(django.db.models.functions.text.Lower('name'), models.F('owner'), name='unique_user_place_name')],
            },
        ),
    ]
