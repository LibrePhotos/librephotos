"""``PhotoMetadata.subject_distance`` and ``digital_zoom_ratio`` (#2265).

The scan read both tags and dropped them; the photo detail's subjectDistance
and digitalZoomRatio were always null. Existing photos get them on a rescan.
"""

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0162_photo_search_folded'),
    ]

    operations = [
        migrations.AddField(
            model_name='photometadata',
            name='digital_zoom_ratio',
            field=models.FloatField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='photometadata',
            name='subject_distance',
            field=models.FloatField(blank=True, null=True),
        ),
    ]
