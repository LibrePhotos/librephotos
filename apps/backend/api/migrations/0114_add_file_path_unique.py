# Generated migration to add unique constraint on File.path
# This migration handles existing duplicate paths before adding the constraint

from django.db import migrations, models


def deduplicate_file_paths(apps, schema_editor):
    """
    Deduplicate File records that have the same path.
    
    Strategy:
    1. Find all paths that have multiple File records
    2. For each duplicate group, keep the "best" File:
       - Prefer non-missing files
       - Prefer files that are main_file for a Photo
       - Prefer files linked to more Photos
    3. Reassign all Photo associations from deleted Files to kept File
    4. Delete duplicate File records
    """
    File = apps.get_model('api', 'File')
    Photo = apps.get_model('api', 'Photo')
    
    from django.db.models import Count, Q
    
    # Find paths that have duplicates (excluding empty paths)
    duplicate_paths = (
        File.objects
        .exclude(path='')
        .exclude(path__isnull=True)
        .values('path')
        .annotate(count=Count('hash'))
        .filter(count__gt=1)
    )
    
    for dup in duplicate_paths:
        path = dup['path']
        
        # Get all Files with this path
        files = list(File.objects.filter(path=path))
        
        if len(files) <= 1:
            continue
        
        # Score each file to determine which to keep
        # Higher score = better candidate to keep
        def score_file(f):
            score = 0
            
            # Prefer non-missing files (+100)
            if not f.missing:
                score += 100
            
            # Prefer files that are main_file for a Photo (+50)
            if Photo.objects.filter(main_file=f).exists():
                score += 50
            
            # Add points for number of Photos this file is associated with
            photo_count = f.photo_set.count() if hasattr(f, 'photo_set') else 0
            score += photo_count
            
            return score
        
        # Sort by score descending, keep the best one
        files_with_scores = [(f, score_file(f)) for f in files]
        files_with_scores.sort(key=lambda x: x[1], reverse=True)
        
        keep_file = files_with_scores[0][0]
        delete_files = [f for f, _ in files_with_scores[1:]]
        
        # Reassign associations from files to be deleted to the kept file
        for del_file in delete_files:
            # Get all Photos that have this file in their files M2M
            photos_with_file = Photo.objects.filter(files=del_file)
            for photo in photos_with_file:
                # Add the kept file if not already present
                if not photo.files.filter(hash=keep_file.hash).exists():
                    photo.files.add(keep_file)
                # Remove the duplicate file
                photo.files.remove(del_file)
            
            # Update main_file references
            photos_with_main = Photo.objects.filter(main_file=del_file)
            for photo in photos_with_main:
                photo.main_file = keep_file
                photo.save(update_fields=['main_file'])
            
            # Handle embedded_media M2M - reassign any references
            # Files that have del_file in their embedded_media
            files_with_embedded = File.objects.filter(embedded_media=del_file)
            for parent_file in files_with_embedded:
                parent_file.embedded_media.remove(del_file)
                if not parent_file.embedded_media.filter(hash=keep_file.hash).exists():
                    parent_file.embedded_media.add(keep_file)
            
            # Delete the duplicate file
            del_file.delete()


def reverse_deduplicate(apps, schema_editor):
    """
    Reverse migration is a no-op since we can't restore deleted duplicates.
    The unique constraint will be dropped by the AlterField reverse.
    """
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0113_alter_photostack_stack_type'),
    ]

    operations = [
        # First, deduplicate existing paths
        migrations.RunPython(
            deduplicate_file_paths,
            reverse_deduplicate,
        ),
        # Then add the unique constraint
        migrations.AlterField(
            model_name='file',
            name='path',
            field=models.TextField(blank=True, default="", unique=True),
        ),
    ]
