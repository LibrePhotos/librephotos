"""Indexes for the date list, the album counts and the job queue poll.

Ported from the Rust backend experiment (#2129), where they cut the date list's
reads of api_photo and api_thumbnail to index-only scans:

- ``photo_owner_visible_idx``: a user's photos with their hidden / trashcan
  flags, covering (INCLUDE is Postgres-only; SQLite gets the plain index).
- ``thumbnail_ready_idx``: the photos whose thumbnail is rendered.
- ``lrj_unfinished_idx``: /api/rqavailable/ finds the running job without
  reading every finished one.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0149_turn_off_public_links_of_deleted_users"),
    ]

    operations = [
        migrations.AddIndex(
            model_name="longrunningjob",
            index=models.Index(
                condition=models.Q(("finished", False)),
                fields=["started_at"],
                name="lrj_unfinished_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="photo",
            index=models.Index(
                fields=["owner", "id"],
                include=("hidden", "in_trashcan"),
                name="photo_owner_visible_idx",
            ),
        ),
        migrations.AddIndex(
            model_name="thumbnail",
            index=models.Index(
                condition=models.Q(("aspect_ratio__isnull", False)),
                fields=["photo"],
                name="thumbnail_ready_idx",
            ),
        ),
    ]
