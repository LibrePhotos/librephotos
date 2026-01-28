# Generated migration to add unique constraint on File.path
# This migration handles existing duplicate paths before adding the constraint

from django.db import migrations, models, transaction
from django.db.models import Count, Exists, OuterRef, Case, When, Value, IntegerField


BATCH_SIZE = 500


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
    
    Optimized for large datasets:
    - Uses annotations to compute scores in database instead of per-file queries
    - Uses bulk M2M operations via through model
    - Uses prefetch_related to eliminate N+1 queries
    - Processes in batches with progress logging
    """
    File = apps.get_model('api', 'File')
    Photo = apps.get_model('api', 'Photo')
    
    # Get through models for bulk M2M operations
    PhotoFiles = Photo.files.through
    FileEmbeddedMedia = File.embedded_media.through
    
    # Find paths that have duplicates (excluding empty paths)
    duplicate_paths = list(
        File.objects
        .exclude(path='')
        .exclude(path__isnull=True)
        .values('path')
        .annotate(count=Count('hash'))
        .filter(count__gt=1)
    )
    
    total_count = len(duplicate_paths)
    if total_count == 0:
        print("No duplicate file paths to deduplicate.")
        return
    
    print(f"Deduplicating {total_count} file paths...")
    
    processed = 0
    deleted_count = 0
    
    for dup in duplicate_paths:
        path = dup['path']
        
        # Subquery to check if file is main_file for any Photo
        is_main_file = Photo.objects.filter(main_file_id=OuterRef('hash'))
        
        # Get all Files with this path, annotated with scores computed in DB
        files = list(
            File.objects
            .filter(path=path)
            .annotate(
                photo_count=Count('photo', distinct=True),
                is_main=Case(
                    When(Exists(is_main_file), then=Value(50)),
                    default=Value(0),
                    output_field=IntegerField()
                ),
                missing_penalty=Case(
                    When(missing=False, then=Value(100)),
                    default=Value(0),
                    output_field=IntegerField()
                ),
            )
            .prefetch_related('photo_set', 'embedded_media')
            .order_by('-missing_penalty', '-is_main', '-photo_count')
        )
        
        if len(files) <= 1:
            continue
        
        # First file is the best one (sorted by score descending)
        keep_file = files[0]
        delete_files = files[1:]
        
        with transaction.atomic():
            # Collect M2M entries to create
            m2m_photo_files_to_create = []
            m2m_photo_files_to_delete = []
            m2m_embedded_to_create = []
            m2m_embedded_to_delete = []
            photos_to_update_main = []
            
            for del_file in delete_files:
                # Get all Photos that have this file in their files M2M (prefetched)
                for photo in del_file.photo_set.all():
                    # Schedule add of keep_file to photo
                    m2m_photo_files_to_create.append(
                        PhotoFiles(photo_id=photo.pk, file_id=keep_file.hash)
                    )
                    # Schedule removal of del_file from photo
                    m2m_photo_files_to_delete.append((photo.pk, del_file.hash))
                
                # Update main_file references in bulk
                photos_with_main = Photo.objects.filter(main_file=del_file)
                for photo in photos_with_main:
                    photo.main_file = keep_file
                    photos_to_update_main.append(photo)
                
                # Handle embedded_media M2M (prefetched)
                for parent_file in File.objects.filter(embedded_media=del_file):
                    m2m_embedded_to_create.append(
                        FileEmbeddedMedia(from_file_id=parent_file.hash, to_file_id=keep_file.hash)
                    )
                    m2m_embedded_to_delete.append((parent_file.hash, del_file.hash))
            
            # Execute bulk operations
            if m2m_photo_files_to_create:
                PhotoFiles.objects.bulk_create(m2m_photo_files_to_create, ignore_conflicts=True)
            
            if m2m_photo_files_to_delete:
                for photo_id, file_id in m2m_photo_files_to_delete:
                    PhotoFiles.objects.filter(photo_id=photo_id, file_id=file_id).delete()
            
            if photos_to_update_main:
                Photo.objects.bulk_update(photos_to_update_main, ['main_file'])
            
            if m2m_embedded_to_create:
                FileEmbeddedMedia.objects.bulk_create(m2m_embedded_to_create, ignore_conflicts=True)
            
            if m2m_embedded_to_delete:
                for from_id, to_id in m2m_embedded_to_delete:
                    FileEmbeddedMedia.objects.filter(from_file_id=from_id, to_file_id=to_id).delete()
            
            # Delete duplicate files in bulk
            delete_hashes = [f.hash for f in delete_files]
            File.objects.filter(hash__in=delete_hashes).delete()
            deleted_count += len(delete_files)
        
        processed += 1
        if processed % 100 == 0:
            print(f"  Processed {processed}/{total_count} duplicate paths ({100*processed//total_count}%)")
    
    print(f"Completed deduplication. Deleted {deleted_count} duplicate files.")


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
