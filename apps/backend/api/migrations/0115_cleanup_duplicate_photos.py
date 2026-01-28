# Generated migration to cleanup duplicate Photo records
# This migration handles Photos with the same image_hash for the same owner

from django.db import migrations


def cleanup_duplicate_photos(apps, schema_editor):
    """
    Cleanup Photo records that have the same image_hash for the same owner.
    
    Strategy:
    1. Find all (image_hash, owner) combinations that have multiple Photo records
    2. For each duplicate group, keep the "best" Photo:
       - Prefer non-removed photos
       - Prefer non-trashed photos
       - Prefer photos with main_file
       - Prefer photos with more files attached
       - Prefer photos with more metadata (faces, albums, etc.)
       - Prefer older photos (smaller added_on)
    3. Merge associations from duplicate Photos to kept Photo:
       - files (M2M)
       - albums (album_user, album_thing, album_place, album_date)
       - faces
       - stacks
       - duplicates (duplicate groups)
       - shared_to
    4. Mark duplicate Photos as removed=True
    """
    Photo = apps.get_model('api', 'Photo')
    Face = apps.get_model('api', 'Face')
    AlbumUser = apps.get_model('api', 'AlbumUser')
    
    from django.db.models import Count, Q, F
    
    # Find (image_hash, owner) combinations with duplicates
    # Exclude already removed photos from consideration
    duplicate_groups = (
        Photo.objects
        .filter(removed=False)
        .values('image_hash', 'owner')
        .annotate(count=Count('id'))
        .filter(count__gt=1)
    )
    
    merged_count = 0
    
    for dup in duplicate_groups:
        image_hash = dup['image_hash']
        owner_id = dup['owner']
        
        # Get all non-removed Photos with this hash/owner
        photos = list(
            Photo.objects
            .filter(image_hash=image_hash, owner_id=owner_id, removed=False)
            .order_by('added_on')  # Prefer older photos
        )
        
        if len(photos) <= 1:
            continue
        
        # Score each photo to determine which to keep
        def score_photo(p):
            score = 0
            
            # Prefer non-removed (+1000)
            if not p.removed:
                score += 1000
            
            # Prefer non-trashed (+500)
            if not p.in_trashcan:
                score += 500
            
            # Prefer photos with main_file (+200)
            if p.main_file_id:
                score += 200
            
            # Add points for number of files attached
            file_count = p.files.count()
            score += file_count * 10
            
            # Add points for faces
            face_count = Face.objects.filter(photo=p).count()
            score += face_count * 5
            
            # Add points for album memberships
            album_count = 0
            try:
                album_count += p.albumuser_set.count()
            except AttributeError:
                pass
            score += album_count * 2
            
            # Prefer photos with clip embeddings
            if p.clip_embeddings:
                score += 50
            
            # Prefer photos with perceptual hash
            if p.perceptual_hash:
                score += 30
            
            # Prefer photos with geolocation
            if p.geolocation_json:
                score += 20
            
            return score
        
        # Sort by score descending, keep the best one
        photos_with_scores = [(p, score_photo(p)) for p in photos]
        photos_with_scores.sort(key=lambda x: (-x[1], x[0].added_on))  # Higher score first, then older
        
        keep_photo = photos_with_scores[0][0]
        merge_photos = [p for p, _ in photos_with_scores[1:]]
        
        # Merge associations from duplicate photos to kept photo
        for merge_photo in merge_photos:
            # Merge files (M2M)
            for file in merge_photo.files.all():
                if not keep_photo.files.filter(hash=file.hash).exists():
                    keep_photo.files.add(file)
            
            # If kept photo has no main_file but merge_photo does, use it
            if not keep_photo.main_file_id and merge_photo.main_file_id:
                keep_photo.main_file = merge_photo.main_file
            
            # Merge faces - update photo reference
            Face.objects.filter(photo=merge_photo).update(photo=keep_photo)
            
            # Merge album memberships (via through tables)
            # AlbumUser
            for album in merge_photo.albumuser_set.all():
                if not keep_photo.albumuser_set.filter(id=album.id).exists():
                    album.photos.add(keep_photo)
            
            # Merge stacks (M2M)
            for stack in merge_photo.stacks.all():
                if not keep_photo.stacks.filter(id=stack.id).exists():
                    keep_photo.stacks.add(stack)
            
            # Merge duplicates (M2M) - the duplicate detection groups
            for duplicate in merge_photo.duplicates.all():
                if not keep_photo.duplicates.filter(id=duplicate.id).exists():
                    keep_photo.duplicates.add(duplicate)
            
            # Merge shared_to (M2M)
            for shared_user in merge_photo.shared_to.all():
                if not keep_photo.shared_to.filter(id=shared_user.id).exists():
                    keep_photo.shared_to.add(shared_user)
            
            # Clear associations from merge_photo before deletion
            merge_photo.files.clear()
            merge_photo.stacks.clear()
            merge_photo.duplicates.clear()
            merge_photo.shared_to.clear()
            
            # Delete the duplicate photo
            merge_photo.delete()
            
            merged_count += 1
        
        keep_photo.save()
    
    if merged_count > 0:
        print(f"Deleted {merged_count} duplicate Photo records")


def reverse_cleanup(apps, schema_editor):
    """
    Reverse migration is a no-op since deleted photos cannot be restored.
    """
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('api', '0114_add_file_path_unique'),
    ]

    operations = [
        migrations.RunPython(
            cleanup_duplicate_photos,
            reverse_cleanup,
        ),
    ]
