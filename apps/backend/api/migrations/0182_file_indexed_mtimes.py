"""What the scan saw of a media file when it last read it (#2296).

Two nullable columns on ``File``; None means "not recorded", so existing rows
keep the old change check until a scan records them. No backfill.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0181_person_groups'),
    ]

    operations = [
        migrations.AddField(
            model_name='file',
            name='indexed_mtime_ns',
            field=models.BigIntegerField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='file',
            name='indexed_sidecar_mtimes',
            field=models.JSONField(blank=True, null=True),
        ),
    ]
