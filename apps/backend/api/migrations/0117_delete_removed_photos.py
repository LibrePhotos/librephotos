# Generated migration to delete removed photos
# These are duplicate photos that were merged in migration 0115

from django.db import migrations


def delete_removed_photos(apps, schema_editor):
    """
    Delete all Photo records marked as removed=True.
    
    These are duplicate photos that were already merged in migration 0115.
    Their relationships (faces, albums, files, stacks, duplicates) were
    reassigned to the kept photo, so these are now orphan records.
    
    Deleting them is cleaner than soft-delete because:
    1. No need to filter removed=True everywhere in queries
    2. No orphan data cluttering the database
    3. Clearer data model
    """
    Photo = apps.get_model('api', 'Photo')
    
    # Find all removed photos
    removed_photos = Photo.objects.filter(removed=True)
    count = removed_photos.count()
    
    if count > 0:
        # Delete them - relationships were already cleared/reassigned in 0115
        removed_photos.delete()
        print(f"Deleted {count} removed (duplicate) photos")


def reverse_delete(apps, schema_editor):
    """
    Reverse migration is a no-op - deleted photos cannot be restored.
    """
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0116_cleanup_duplicate_groups_removed_photos'),
    ]

    operations = [
        migrations.RunPython(delete_removed_photos, reverse_delete),
    ]
