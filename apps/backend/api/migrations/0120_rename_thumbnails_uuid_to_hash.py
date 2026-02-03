# Migration to rename thumbnail files from UUID to image_hash
# This migration fixes the thumbnail naming issue where thumbnails were being
# created with UUID names but the frontend expected image_hash names

import os
from django.conf import settings
from django.db import migrations


def rename_thumbnails_uuid_to_hash(apps, schema_editor):
    """
    Rename existing thumbnail files from UUID-based names to image_hash-based names.
    This only renames files that exist and updates the database records.
    """
    Photo = apps.get_model('api', 'Photo')
    Thumbnail = apps.get_model('api', 'Thumbnail')
    
    # Get all photos with thumbnails
    thumbnails = Thumbnail.objects.select_related('photo').all()
    
    renamed_count = 0
    skipped_count = 0
    
    for thumbnail in thumbnails:
        photo = thumbnail.photo
        photo_uuid = str(photo.id)
        photo_hash = photo.image_hash
        
        # Skip if UUID and hash are the same (shouldn't happen, but be safe)
        if photo_uuid == photo_hash:
            continue
        
        # Process each thumbnail type
        thumbnail_types = [
            ('thumbnails_big', '.webp', False),  # (path, extension, is_video)
            ('square_thumbnails', '.webp' if not photo.video else '.mp4', photo.video),
            ('square_thumbnails_small', '.webp' if not photo.video else '.mp4', photo.video),
        ]
        
        needs_update = False
        
        for thumb_dir, ext, _ in thumbnail_types:
            old_path = os.path.join(settings.MEDIA_ROOT, thumb_dir, f"{photo_uuid}{ext}")
            new_path = os.path.join(settings.MEDIA_ROOT, thumb_dir, f"{photo_hash}{ext}")
            
            # Only rename if old file exists and new file doesn't
            if os.path.exists(old_path) and not os.path.exists(new_path):
                try:
                    os.rename(old_path, new_path)
                    needs_update = True
                except Exception as e:
                    print(f"Warning: Could not rename {old_path} to {new_path}: {e}")
        
        # Update database record if any files were renamed
        if needs_update:
            filetype = '.mp4' if photo.video else '.webp'
            thumbnail.thumbnail_big = os.path.join('thumbnails_big', f"{photo_hash}.webp")
            thumbnail.square_thumbnail = os.path.join('square_thumbnails', f"{photo_hash}{filetype}")
            thumbnail.square_thumbnail_small = os.path.join('square_thumbnails_small', f"{photo_hash}{filetype}")
            thumbnail.save(update_fields=['thumbnail_big', 'square_thumbnail', 'square_thumbnail_small'])
            renamed_count += 1
        else:
            skipped_count += 1
    
    print(f"Renamed thumbnails for {renamed_count} photos, skipped {skipped_count} photos")


def reverse_rename_thumbnails(apps, schema_editor):
    """
    This migration cannot be easily reversed because we would need to know
    the original UUID for each photo. The forward migration renames files
    from UUID to image_hash, but reversing would require knowing which UUID
    was used originally, which we don't store.
    """
    print("Warning: This migration cannot be reversed. Thumbnails will keep image_hash names.")
    print("If you need to revert, regenerate thumbnails from scratch.")


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0119_add_public_sharing_options'),
    ]

    operations = [
        migrations.RunPython(
            rename_thumbnails_uuid_to_hash,
            reverse_rename_thumbnails,
        ),
    ]
