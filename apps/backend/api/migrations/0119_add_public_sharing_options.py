# Generated migration for public sharing options

from django.db import migrations, models
import api.models.user


class Migration(migrations.Migration):

    dependencies = [
        ("api", "0118_alter_longrunningjob_job_type"),
    ]

    operations = [
        # Add public_sharing_defaults to User model
        migrations.AddField(
            model_name="user",
            name="public_sharing_defaults",
            field=models.JSONField(default=api.models.user.get_default_public_sharing_settings),
        ),
        # Add sharing option fields to AlbumUserShare model
        migrations.AddField(
            model_name="albumusershare",
            name="share_location",
            field=models.BooleanField(blank=True, default=None, null=True),
        ),
        migrations.AddField(
            model_name="albumusershare",
            name="share_camera_info",
            field=models.BooleanField(blank=True, default=None, null=True),
        ),
        migrations.AddField(
            model_name="albumusershare",
            name="share_timestamps",
            field=models.BooleanField(blank=True, default=None, null=True),
        ),
        migrations.AddField(
            model_name="albumusershare",
            name="share_captions",
            field=models.BooleanField(blank=True, default=None, null=True),
        ),
        migrations.AddField(
            model_name="albumusershare",
            name="share_faces",
            field=models.BooleanField(blank=True, default=None, null=True),
        ),
    ]
