"""What a duplicate review did, and two MetadataEdit columns nothing wrote.

- ``Duplicate.trashed_photos``: the photos a resolve moved to the trash, the
  only ones a revert takes out again. A group resolved before this records
  the photos of the group in the trash but the kept one, the ones a revert
  restored until now.
- "Not duplicates" used to unlink the photos and leave an empty row behind,
  which no list showed and nothing could undo. It keeps the photos now; the
  empty dismissed rows are deleted.
- ``MetadataEdit.synced_to_file`` and ``synced_at`` were never written: the
  write-back writes a photo's current values, not one edit.
"""

from django.db import migrations, models


def record_trashed_photos(apps, schema_editor):
    Duplicate = apps.get_model("api", "Duplicate")
    Trashed = Duplicate.trashed_photos.through
    resolved = Duplicate.objects.filter(review_status="resolved", trashed_count__gt=0)
    for duplicate in resolved.iterator():
        photo_ids = duplicate.photos.filter(in_trashcan=True)
        if duplicate.kept_photo_id is not None:
            photo_ids = photo_ids.exclude(pk=duplicate.kept_photo_id)
        Trashed.objects.bulk_create(
            [
                Trashed(duplicate_id=duplicate.pk, photo_id=photo_id)
                for photo_id in photo_ids.values_list("pk", flat=True)
            ]
        )


def delete_empty_dismissed_groups(apps, schema_editor):
    Duplicate = apps.get_model("api", "Duplicate")
    Duplicate.objects.filter(review_status="dismissed", photos__isnull=True).delete()


class Migration(migrations.Migration):
    dependencies = [
        ("api", "0234_photo_removed_at"),
    ]

    operations = [
        migrations.RemoveField(
            model_name="metadataedit",
            name="synced_at",
        ),
        migrations.RemoveField(
            model_name="metadataedit",
            name="synced_to_file",
        ),
        migrations.AddField(
            model_name="duplicate",
            name="trashed_photos",
            field=models.ManyToManyField(
                blank=True, related_name="trashed_by_duplicates", to="api.photo"
            ),
        ),
        migrations.RunPython(record_trashed_photos, migrations.RunPython.noop),
        migrations.RunPython(delete_empty_dismissed_groups, migrations.RunPython.noop),
    ]
