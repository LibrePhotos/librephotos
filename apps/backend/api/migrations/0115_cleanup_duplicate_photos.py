# Generated migration to cleanup duplicate Photo records
# This migration handles Photos with the same image_hash for the same owner

from django.db import migrations, transaction
from django.db.models import Count, Case, When, Value, F, IntegerField


BATCH_SIZE = 100


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
    4. Delete duplicate Photos
    
    Optimized for large datasets:
    - Uses database annotations to compute scores instead of per-photo queries
    - Uses bulk M2M operations via through model
    - Uses prefetch_related to eliminate N+1 queries
    - Processes in batches with progress logging
    """
    Photo = apps.get_model('api', 'Photo')
    Face = apps.get_model('api', 'Face')
    AlbumUser = apps.get_model('api', 'AlbumUser')
    
    # Get through models for bulk M2M operations
    PhotoFiles = Photo.files.through
    PhotoStacks = Photo.stacks.through
    PhotoDuplicates = Photo.duplicates.through
    PhotoSharedTo = Photo.shared_to.through
    AlbumUserPhotos = AlbumUser.photos.through
    
    # Find (image_hash, owner) combinations with duplicates
    # Exclude already removed photos from consideration
    duplicate_groups = list(
        Photo.objects
        .filter(removed=False)
        .values('image_hash', 'owner')
        .annotate(count=Count('id'))
        .filter(count__gt=1)
    )
    
    total_count = len(duplicate_groups)
    if total_count == 0:
        print("No duplicate photos to clean up.")
        return
    
    print(f"Cleaning up {total_count} duplicate photo groups...")
    
    merged_count = 0
    processed = 0
    
    for dup in duplicate_groups:
        image_hash = dup['image_hash']
        owner_id = dup['owner']
        
        # Get all non-removed Photos with this hash/owner
        # Annotate with scores computed in database
        photos = list(
            Photo.objects
            .filter(image_hash=image_hash, owner_id=owner_id, removed=False)
            .annotate(
                file_count=Count('files', distinct=True),
                face_count=Count('face', distinct=True),
                album_count=Count('albumuser', distinct=True),
                stack_count=Count('stacks', distinct=True),
                # Compute score in database
                score=(
                    Case(When(removed=False, then=Value(1000)), default=Value(0), output_field=IntegerField()) +
                    Case(When(in_trashcan=False, then=Value(500)), default=Value(0), output_field=IntegerField()) +
                    Case(When(main_file__isnull=False, then=Value(200)), default=Value(0), output_field=IntegerField()) +
                    F('file_count') * 10 +
                    F('face_count') * 5 +
                    F('album_count') * 2 +
                    F('stack_count') * 2 +
                    Case(When(clip_embeddings__isnull=False, then=Value(50)), default=Value(0), output_field=IntegerField()) +
                    Case(When(perceptual_hash__isnull=False, then=Value(30)), default=Value(0), output_field=IntegerField()) +
                    Case(When(geolocation_json__isnull=False, then=Value(20)), default=Value(0), output_field=IntegerField())
                )
            )
            .select_related('main_file')
            .prefetch_related('files', 'stacks', 'duplicates', 'shared_to', 'albumuser_set')
            .order_by('-score', 'added_on')  # Higher score first, then older
        )
        
        if len(photos) <= 1:
            continue
        
        keep_photo = photos[0]
        merge_photos = photos[1:]
        merge_ids = [p.pk for p in merge_photos]
        
        with transaction.atomic():
            # Bulk update faces - single query
            Face.objects.filter(photo_id__in=merge_ids).update(photo=keep_photo)
            
            # Collect existing M2M IDs to prevent duplicates
            existing_file_ids = set(keep_photo.files.values_list('hash', flat=True))
            existing_stack_ids = set(keep_photo.stacks.values_list('id', flat=True))
            existing_duplicate_ids = set(keep_photo.duplicates.values_list('id', flat=True))
            existing_shared_ids = set(keep_photo.shared_to.values_list('id', flat=True))
            existing_album_ids = set(keep_photo.albumuser_set.values_list('id', flat=True))
            
            # Collect M2M entries to create
            new_files = []
            new_stacks = []
            new_duplicates = []
            new_shared = []
            new_albums = []
            
            # Track if we need to update main_file
            main_file_candidate = None
            
            for merge_photo in merge_photos:
                # Collect files (prefetched)
                for file in merge_photo.files.all():
                    if file.hash not in existing_file_ids:
                        new_files.append(PhotoFiles(photo_id=keep_photo.pk, file_id=file.hash))
                        existing_file_ids.add(file.hash)
                
                # If kept photo has no main_file but merge_photo does, remember it
                if not keep_photo.main_file_id and merge_photo.main_file_id and not main_file_candidate:
                    main_file_candidate = merge_photo.main_file
                
                # Collect stacks (prefetched)
                for stack in merge_photo.stacks.all():
                    if stack.id not in existing_stack_ids:
                        new_stacks.append(PhotoStacks(photo_id=keep_photo.pk, photostack_id=stack.id))
                        existing_stack_ids.add(stack.id)
                
                # Collect duplicates (prefetched)
                for dup_group in merge_photo.duplicates.all():
                    if dup_group.id not in existing_duplicate_ids:
                        new_duplicates.append(PhotoDuplicates(photo_id=keep_photo.pk, duplicate_id=dup_group.id))
                        existing_duplicate_ids.add(dup_group.id)
                
                # Collect shared_to (prefetched)
                for user in merge_photo.shared_to.all():
                    if user.id not in existing_shared_ids:
                        new_shared.append(PhotoSharedTo(photo_id=keep_photo.pk, user_id=user.id))
                        existing_shared_ids.add(user.id)
                
                # Collect album memberships (prefetched)
                for album in merge_photo.albumuser_set.all():
                    if album.id not in existing_album_ids:
                        new_albums.append(AlbumUserPhotos(albumuser_id=album.id, photo_id=keep_photo.pk))
                        existing_album_ids.add(album.id)
            
            # Bulk create all M2M relationships
            if new_files:
                PhotoFiles.objects.bulk_create(new_files, ignore_conflicts=True)
            if new_stacks:
                PhotoStacks.objects.bulk_create(new_stacks, ignore_conflicts=True)
            if new_duplicates:
                PhotoDuplicates.objects.bulk_create(new_duplicates, ignore_conflicts=True)
            if new_shared:
                PhotoSharedTo.objects.bulk_create(new_shared, ignore_conflicts=True)
            if new_albums:
                AlbumUserPhotos.objects.bulk_create(new_albums, ignore_conflicts=True)
            
            # Update main_file if needed
            if main_file_candidate:
                keep_photo.main_file = main_file_candidate
                keep_photo.save(update_fields=['main_file'])
            
            # Bulk delete merge photos
            # Django's delete() on queryset handles M2M clearing automatically
            Photo.objects.filter(pk__in=merge_ids).delete()
            merged_count += len(merge_ids)
        
        processed += 1
        if processed % BATCH_SIZE == 0:
            print(f"  Processed {processed}/{total_count} duplicate groups ({100*processed//total_count}%)")
    
    if merged_count > 0:
        print(f"Completed cleanup. Deleted {merged_count} duplicate Photo records.")


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
