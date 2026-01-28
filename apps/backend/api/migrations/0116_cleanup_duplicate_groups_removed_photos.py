# Generated migration to clean up Duplicate groups containing removed photos
# This removes removed=True photos from groups and deletes groups with 0-1 photos remaining

from django.db import migrations


def cleanup_duplicate_groups(apps, schema_editor):
    """
    Remove removed=True photos from Duplicate groups.
    Delete Duplicate groups that end up with 0 or 1 photos.
    
    This is needed because migration 0115 marks duplicate Photos as removed=True
    but doesn't remove them from their Duplicate group M2M relationships.
    """
    Duplicate = apps.get_model('api', 'Duplicate')
    
    cleaned_count = 0
    deleted_count = 0
    
    for duplicate in Duplicate.objects.all():
        # Get removed photos in this group
        removed_photos = duplicate.photos.filter(removed=True)
        removed_count = removed_photos.count()
        
        if removed_count > 0:
            # Remove the removed photos from the group
            for photo in removed_photos:
                duplicate.photos.remove(photo)
            cleaned_count += removed_count
        
        # Check if group now has 0 or 1 photos (no longer a valid duplicate group)
        remaining = duplicate.photos.filter(removed=False).count()
        if remaining <= 1:
            # Clear remaining photos first to avoid orphan M2M entries
            duplicate.photos.clear()
            duplicate.delete()
            deleted_count += 1
    
    if cleaned_count or deleted_count:
        print(f"Cleaned {cleaned_count} removed photos from duplicate groups")
        print(f"Deleted {deleted_count} empty/single-photo duplicate groups")


def reverse_cleanup(apps, schema_editor):
    """
    Reverse migration is a no-op since we can't restore removed photos to groups.
    The photos still exist (just marked removed=True) but we don't track which
    groups they belonged to.
    """
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0115_cleanup_duplicate_photos'),
    ]

    operations = [
        migrations.RunPython(cleanup_duplicate_groups, reverse_cleanup),
    ]
