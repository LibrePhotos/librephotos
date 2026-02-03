"""
Migration to convert RAW_JPEG_PAIR and LIVE_PHOTO stacks to file variants.

This migration implements the PhotoPrism-like file variant model where:
- RAW+JPEG pairs become one Photo with multiple files
- Live Photos (image+video) become one Photo with multiple files

Instead of having 2 Photo entities in a stack, we now have 1 Photo entity
with multiple File entries in its files ManyToMany field.

This is a data migration that:
1. For each RAW_JPEG_PAIR stack:
   - Identifies the JPEG Photo (primary) and RAW Photo
   - Moves the RAW file to the JPEG Photo's files field
   - Deletes the RAW Photo entity
   - Deletes the stack
2. For each LIVE_PHOTO stack:
   - Identifies the image Photo (primary) and video Photo
   - Moves the video file to the image Photo's files field
   - Deletes the video Photo entity
   - Deletes the stack

Optimized for large datasets:
- Uses prefetch_related to eliminate N+1 queries
- Uses bulk M2M operations via through model
- Processes in batches with progress logging
"""

from django.db import migrations, transaction
from django.db.models import Prefetch


BATCH_SIZE = 500


def convert_raw_jpeg_stacks_to_file_variants(apps, schema_editor):
    """Convert RAW_JPEG_PAIR stacks to Photo.files variants."""
    PhotoStack = apps.get_model('api', 'PhotoStack')
    Photo = apps.get_model('api', 'Photo')
    File = apps.get_model('api', 'File')
    
    # Get through model for bulk M2M operations
    PhotoFiles = Photo.files.through
    PhotoStacks = Photo.stacks.through
    
    # RAW_JPEG_PAIR = "raw_jpeg"
    # Count total for progress logging
    total_count = PhotoStack.objects.filter(stack_type="raw_jpeg").count()
    if total_count == 0:
        print("No RAW_JPEG_PAIR stacks to convert.")
        return
    
    print(f"Converting {total_count} RAW_JPEG_PAIR stacks to file variants...")
    
    # Prefetch photos with their files and main_file to eliminate N+1 queries
    raw_jpeg_stacks = (
        PhotoStack.objects
        .filter(stack_type="raw_jpeg")
        .prefetch_related(
            Prefetch(
                'photos',
                queryset=Photo.objects.select_related('main_file').prefetch_related('files')
            )
        )
    )
    
    converted_count = 0
    error_count = 0
    
    # Collect bulk operations
    m2m_files_to_create = []
    photos_to_delete = []
    stacks_to_delete = []
    m2m_stacks_to_delete = []
    
    for stack in raw_jpeg_stacks.iterator(chunk_size=BATCH_SIZE):
        try:
            # Photos are already prefetched - no extra query
            photos = list(stack.photos.all())
            
            if len(photos) != 2:
                print(f"WARNING: RAW_JPEG stack {stack.id} has {len(photos)} photos, expected 2. Skipping.")
                error_count += 1
                continue
            
            # Identify JPEG and RAW photos
            # RAW files have type=4 in File model
            jpeg_photo = None
            raw_photo = None
            
            for photo in photos:
                if photo.main_file and photo.main_file.type == 4:  # RAW_FILE
                    raw_photo = photo
                else:
                    jpeg_photo = photo
            
            if not jpeg_photo or not raw_photo:
                print(f"WARNING: Could not identify JPEG/RAW in stack {stack.id}. Skipping.")
                error_count += 1
                continue
            
            # Collect files to add to jpeg_photo (using prefetched data)
            files_to_add = list(raw_photo.files.all())
            if raw_photo.main_file:
                files_to_add.append(raw_photo.main_file)
            
            # Build M2M through model entries for bulk create
            existing_file_hashes = set(f.hash for f in jpeg_photo.files.all())
            for file in files_to_add:
                if file.hash not in existing_file_hashes:
                    m2m_files_to_create.append(
                        PhotoFiles(photo_id=jpeg_photo.pk, file_id=file.hash)
                    )
                    existing_file_hashes.add(file.hash)
            
            # Collect M2M stack relationships to delete
            for photo in photos:
                m2m_stacks_to_delete.append((photo.pk, stack.pk))
            
            photos_to_delete.append(raw_photo.pk)
            stacks_to_delete.append(stack.pk)
            converted_count += 1
            
            # Process in batches to avoid memory buildup
            if len(stacks_to_delete) >= BATCH_SIZE:
                _flush_raw_jpeg_batch(
                    PhotoFiles, PhotoStacks, Photo, PhotoStack,
                    m2m_files_to_create, m2m_stacks_to_delete, photos_to_delete, stacks_to_delete
                )
                m2m_files_to_create = []
                m2m_stacks_to_delete = []
                photos_to_delete = []
                stacks_to_delete = []
                print(f"  Processed {converted_count}/{total_count} stacks ({100*converted_count//total_count}%)")
            
        except Exception as e:
            print(f"ERROR converting RAW_JPEG stack {stack.id}: {e}")
            error_count += 1
    
    # Flush remaining batch
    if stacks_to_delete:
        _flush_raw_jpeg_batch(
            PhotoFiles, PhotoStacks, Photo, PhotoStack,
            m2m_files_to_create, m2m_stacks_to_delete, photos_to_delete, stacks_to_delete
        )
    
    print(f"Converted {converted_count} RAW_JPEG_PAIR stacks to file variants ({error_count} errors)")


def _flush_raw_jpeg_batch(PhotoFiles, PhotoStacks, Photo, PhotoStack,
                          m2m_files_to_create, m2m_stacks_to_delete, photos_to_delete, stacks_to_delete):
    """Flush a batch of operations to the database."""
    with transaction.atomic():
        # Bulk create M2M file relationships
        if m2m_files_to_create:
            PhotoFiles.objects.bulk_create(m2m_files_to_create, ignore_conflicts=True)
        
        # Bulk delete M2M stack relationships
        if m2m_stacks_to_delete:
            for photo_id, stack_id in m2m_stacks_to_delete:
                PhotoStacks.objects.filter(photo_id=photo_id, photostack_id=stack_id).delete()
        
        # Bulk delete photos
        if photos_to_delete:
            Photo.objects.filter(pk__in=photos_to_delete).delete()
        
        # Bulk delete stacks
        if stacks_to_delete:
            PhotoStack.objects.filter(pk__in=stacks_to_delete).delete()


def convert_live_photo_stacks_to_file_variants(apps, schema_editor):
    """Convert LIVE_PHOTO stacks to Photo.files variants."""
    PhotoStack = apps.get_model('api', 'PhotoStack')
    Photo = apps.get_model('api', 'Photo')
    File = apps.get_model('api', 'File')
    
    # Get through model for bulk M2M operations
    PhotoFiles = Photo.files.through
    PhotoStacks = Photo.stacks.through
    
    # LIVE_PHOTO = "live_photo"
    # Count total for progress logging
    total_count = PhotoStack.objects.filter(stack_type="live_photo").count()
    if total_count == 0:
        print("No LIVE_PHOTO stacks to convert.")
        return
    
    print(f"Converting {total_count} LIVE_PHOTO stacks to file variants...")
    
    # Prefetch photos with their files and main_file to eliminate N+1 queries
    live_photo_stacks = (
        PhotoStack.objects
        .filter(stack_type="live_photo")
        .prefetch_related(
            Prefetch(
                'photos',
                queryset=Photo.objects.select_related('main_file').prefetch_related('files')
            )
        )
    )
    
    converted_count = 0
    error_count = 0
    
    # Collect bulk operations
    m2m_files_to_create = []
    photos_to_delete = []
    stacks_to_delete = []
    m2m_stacks_to_delete = []
    
    for stack in live_photo_stacks.iterator(chunk_size=BATCH_SIZE):
        try:
            # Photos are already prefetched - no extra query
            photos = list(stack.photos.all())
            
            if len(photos) != 2:
                print(f"WARNING: LIVE_PHOTO stack {stack.id} has {len(photos)} photos, expected 2. Skipping.")
                error_count += 1
                continue
            
            # Identify image and video photos
            # VIDEO files have type=2 in File model
            image_photo = None
            video_photo = None
            
            for photo in photos:
                if photo.main_file and photo.main_file.type == 2:  # VIDEO
                    video_photo = photo
                elif photo.video:
                    video_photo = photo
                else:
                    image_photo = photo
            
            if not image_photo or not video_photo:
                print(f"WARNING: Could not identify image/video in LIVE_PHOTO stack {stack.id}. Skipping.")
                error_count += 1
                continue
            
            # Collect files to add to image_photo (using prefetched data)
            files_to_add = list(video_photo.files.all())
            if video_photo.main_file:
                files_to_add.append(video_photo.main_file)
            
            # Build M2M through model entries for bulk create
            existing_file_hashes = set(f.hash for f in image_photo.files.all())
            for file in files_to_add:
                if file.hash not in existing_file_hashes:
                    m2m_files_to_create.append(
                        PhotoFiles(photo_id=image_photo.pk, file_id=file.hash)
                    )
                    existing_file_hashes.add(file.hash)
            
            # Collect M2M stack relationships to delete
            for photo in photos:
                m2m_stacks_to_delete.append((photo.pk, stack.pk))
            
            photos_to_delete.append(video_photo.pk)
            stacks_to_delete.append(stack.pk)
            converted_count += 1
            
            # Process in batches to avoid memory buildup
            if len(stacks_to_delete) >= BATCH_SIZE:
                _flush_live_photo_batch(
                    PhotoFiles, PhotoStacks, Photo, PhotoStack,
                    m2m_files_to_create, m2m_stacks_to_delete, photos_to_delete, stacks_to_delete
                )
                m2m_files_to_create = []
                m2m_stacks_to_delete = []
                photos_to_delete = []
                stacks_to_delete = []
                print(f"  Processed {converted_count}/{total_count} stacks ({100*converted_count//total_count}%)")
            
        except Exception as e:
            print(f"ERROR converting LIVE_PHOTO stack {stack.id}: {e}")
            error_count += 1
    
    # Flush remaining batch
    if stacks_to_delete:
        _flush_live_photo_batch(
            PhotoFiles, PhotoStacks, Photo, PhotoStack,
            m2m_files_to_create, m2m_stacks_to_delete, photos_to_delete, stacks_to_delete
        )
    
    print(f"Converted {converted_count} LIVE_PHOTO stacks to file variants ({error_count} errors)")


def _flush_live_photo_batch(PhotoFiles, PhotoStacks, Photo, PhotoStack,
                            m2m_files_to_create, m2m_stacks_to_delete, photos_to_delete, stacks_to_delete):
    """Flush a batch of operations to the database."""
    with transaction.atomic():
        # Bulk create M2M file relationships
        if m2m_files_to_create:
            PhotoFiles.objects.bulk_create(m2m_files_to_create, ignore_conflicts=True)
        
        # Bulk delete M2M stack relationships
        if m2m_stacks_to_delete:
            for photo_id, stack_id in m2m_stacks_to_delete:
                PhotoStacks.objects.filter(photo_id=photo_id, photostack_id=stack_id).delete()
        
        # Bulk delete photos
        if photos_to_delete:
            Photo.objects.filter(pk__in=photos_to_delete).delete()
        
        # Bulk delete stacks
        if stacks_to_delete:
            PhotoStack.objects.filter(pk__in=stacks_to_delete).delete()


def forward_migration(apps, schema_editor):
    """Run both conversions."""
    convert_raw_jpeg_stacks_to_file_variants(apps, schema_editor)
    convert_live_photo_stacks_to_file_variants(apps, schema_editor)


def reverse_migration(apps, schema_editor):
    """
    Reverse migration is not fully supported as we've deleted Photo entities.
    This would require recreating the deleted Photos which is complex.
    Instead, we just print a warning.
    """
    print("WARNING: Reverse migration is not supported. "
          "RAW_JPEG_PAIR and LIVE_PHOTO stacks cannot be recreated automatically. "
          "Run a full rescan to detect file variants again.")


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0111_alter_file_embedded_media'),
    ]

    operations = [
        migrations.RunPython(forward_migration, reverse_migration),
    ]
