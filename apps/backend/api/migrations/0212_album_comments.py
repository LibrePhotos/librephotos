"""Comments and likes on the photos of shared albums (#262)."""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0211_collaborative_albums'),
    ]

    operations = [
        migrations.AddField(
            model_name='albumuser',
            name='comments_enabled',
            field=models.BooleanField(default=True),
        ),
        migrations.CreateModel(
            name='AlbumComment',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('text', models.TextField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('edited_at', models.DateTimeField(blank=True, null=True)),
                ('album', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='comments', to='api.albumuser')),
                ('author', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='album_comments', to=settings.AUTH_USER_MODEL)),
                ('photo', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='album_comments', to='api.photo')),
            ],
            options={
                'indexes': [models.Index(fields=['album', 'photo', 'created_at'], name='api_albumco_album_i_c74d58_idx')],
            },
        ),
        migrations.CreateModel(
            name='AlbumLike',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('album', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='likes', to='api.albumuser')),
                ('photo', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='album_likes', to='api.photo')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='album_likes', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'unique_together': {('album', 'photo', 'user')},
            },
        ),
    ]
