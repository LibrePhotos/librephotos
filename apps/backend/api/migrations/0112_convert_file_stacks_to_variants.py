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
"""

from django.db import migrations


def convert_raw_jpeg_stacks_to_file_variants(apps, schema_editor):
    """Convert RAW_JPEG_PAIR stacks to Photo.files variants."""
    PhotoStack = apps.get_model('api', 'PhotoStack')
    Photo = apps.get_model('api', 'Photo')
    File = apps.get_model('api', 'File')
    
    # RAW_JPEG_PAIR = "raw_jpeg"
    raw_jpeg_stacks = PhotoStack.objects.filter(stack_type="raw_jpeg")
    
    converted_count = 0
    error_count = 0
    
    for stack in raw_jpeg_stacks:
        try:
            photos = list(stack.photos.all())
            
            if len(photos) != 2:
                # Unexpected number of photos, skip
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
            
            # Move RAW file to JPEG Photo's files field
            if raw_photo.main_file:
                jpeg_photo.files.add(raw_photo.main_file)
                # Also add any other files from RAW photo
                for f in raw_photo.files.all():
                    if f != raw_photo.main_file:
                        jpeg_photo.files.add(f)
            
            # Remove photos from stack
            for photo in photos:
                photo.stacks.remove(stack)
            
            # Delete the RAW Photo entity
            raw_photo.delete()
            
            # Delete the stack
            stack.delete()
            
            converted_count += 1
            
        except Exception as e:
            print(f"ERROR converting RAW_JPEG stack {stack.id}: {e}")
            error_count += 1
    
    print(f"Converted {converted_count} RAW_JPEG_PAIR stacks to file variants ({error_count} errors)")


def convert_live_photo_stacks_to_file_variants(apps, schema_editor):
    """Convert LIVE_PHOTO stacks to Photo.files variants."""
    PhotoStack = apps.get_model('api', 'PhotoStack')
    Photo = apps.get_model('api', 'Photo')
    File = apps.get_model('api', 'File')
    
    # LIVE_PHOTO = "live_photo"
    live_photo_stacks = PhotoStack.objects.filter(stack_type="live_photo")
    
    converted_count = 0
    error_count = 0
    
    for stack in live_photo_stacks:
        try:
            photos = list(stack.photos.all())
            
            if len(photos) != 2:
                # Unexpected number of photos, skip
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
            
            # Move video file to image Photo's files field
            if video_photo.main_file:
                image_photo.files.add(video_photo.main_file)
                # Also add any other files from video photo
                for f in video_photo.files.all():
                    if f != video_photo.main_file:
                        image_photo.files.add(f)
            
            # Remove photos from stack
            for photo in photos:
                photo.stacks.remove(stack)
            
            # Delete the video Photo entity
            video_photo.delete()
            
            # Delete the stack
            stack.delete()
            
            converted_count += 1
            
        except Exception as e:
            print(f"ERROR converting LIVE_PHOTO stack {stack.id}: {e}")
            error_count += 1
    
    print(f"Converted {converted_count} LIVE_PHOTO stacks to file variants ({error_count} errors)")


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
