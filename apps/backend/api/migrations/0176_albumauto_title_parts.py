"""``AlbumAuto.title_parts``: the parts an event title is worded from (#2235).

Empty for existing albums: the next event run or "Regenerate event titles"
fills it, and clients show ``title`` until then.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0175_salt_image_hashes_per_owner"),
    ]

    operations = [
        migrations.AddField(
            model_name="albumauto",
            name="title_parts",
            field=models.JSONField(blank=True, null=True),
        ),
    ]
