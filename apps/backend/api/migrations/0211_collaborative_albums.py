"""Collaborative albums (#464): roles for album members, who added a photo.

``AlbumUser.shared_to`` and ``AlbumUser.photos`` get explicit through models
on the tables their plain many-to-many fields already had
(``api_albumuser_shared_to``, ``api_albumuser_photos``): the first operation
only tells Django's state about them, the table and its rows stay. Then the
new columns are added: a member's role and their switches, the link's
``added_by``, and the owner's ceiling of what members see. Every existing
member becomes a viewer, every existing link has no ``added_by`` (the owner's,
then), so nothing anyone sees changes.
"""

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models
from django.db.models import F


def drop_links_to_other_users_photos(apps, schema_editor):
    """Albums only hold photos their owner or a current contributor added.

    A link to another user's photo made before contributors existed (no
    ``added_by``) never shows through the album; it is removed, as is a cover
    that is another user's photo.
    """
    AlbumUserPhoto = apps.get_model("api", "AlbumUserPhoto")
    AlbumUser = apps.get_model("api", "AlbumUser")
    AlbumUserPhoto.objects.filter(added_by__isnull=True).exclude(
        photo__owner_id=F("albumuser__owner_id")
    ).delete()
    AlbumUser.objects.exclude(cover_photo=None).exclude(
        cover_photo__owner_id=F("owner_id")
    ).update(cover_photo=None)


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0210_library_share'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            state_operations=[
                migrations.CreateModel(
                    name='AlbumUserMember',
                    fields=[
                        ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                        ('albumuser', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='memberships', to='api.albumuser')),
                        ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='album_memberships', to=settings.AUTH_USER_MODEL)),
                    ],
                    options={
                        'db_table': 'api_albumuser_shared_to',
                        'unique_together': {('albumuser', 'user')},
                    },
                ),
                migrations.AlterField(
                    model_name='albumuser',
                    name='shared_to',
                    field=models.ManyToManyField(related_name='album_user_shared_to', through='api.AlbumUserMember', to=settings.AUTH_USER_MODEL),
                ),
                migrations.CreateModel(
                    name='AlbumUserPhoto',
                    fields=[
                        ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                        ('albumuser', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='photo_links', to='api.albumuser')),
                        ('photo', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='album_user_links', to='api.photo')),
                    ],
                    options={
                        'db_table': 'api_albumuser_photos',
                        'unique_together': {('albumuser', 'photo')},
                    },
                ),
                migrations.AlterField(
                    model_name='albumuser',
                    name='photos',
                    field=models.ManyToManyField(through='api.AlbumUserPhoto', to='api.photo'),
                ),
            ],
        ),
        migrations.AddField(
            model_name='albumusermember',
            name='role',
            field=models.CharField(choices=[('viewer', 'Can view'), ('contributor', 'Can add photos')], default='viewer', max_length=16),
        ),
        migrations.AddField(
            model_name='albumusermember',
            name='share_location',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='albumusermember',
            name='share_faces',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='albumusermember',
            name='share_camera_info',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='albumusermember',
            name='share_captions',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='albumusermember',
            name='share_originals',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='albumuserphoto',
            name='added_by',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.CASCADE, related_name='+', to=settings.AUTH_USER_MODEL),
        ),
        migrations.AddField(
            model_name='albumuser',
            name='members_share_location',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='albumuser',
            name='members_share_faces',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='albumuser',
            name='members_share_camera_info',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='albumuser',
            name='members_share_captions',
            field=models.BooleanField(default=True),
        ),
        migrations.AddField(
            model_name='albumuser',
            name='members_share_originals',
            field=models.BooleanField(default=True),
        ),
        migrations.CreateModel(
            name='CopyBudget',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('hour', models.DateTimeField(blank=True, null=True)),
                ('made', models.PositiveIntegerField(default=0)),
                ('user', models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name='copy_budget', to=settings.AUTH_USER_MODEL)),
            ],
        ),
        migrations.RunPython(drop_links_to_other_users_photos, migrations.RunPython.noop),
    ]
