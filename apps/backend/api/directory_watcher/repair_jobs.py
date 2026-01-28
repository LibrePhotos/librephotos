"""
Repair jobs for fixing ungrouped file variants.

This module contains jobs that repair data inconsistencies, such as
RAW files that weren't properly grouped with their JPEG counterparts
due to race conditions in previous scans.
"""

from uuid import UUID

from api import util
from api.models import File, LongRunningJob, Photo
from api.directory_watcher.file_grouping import find_matching_jpeg_photo


def repair_ungrouped_file_variants(user, job_id: UUID):
    """
    Post-scan job to fix any ungrouped file variants.
    
    This handles:
    1. Race conditions from previous scans where RAW+JPEG weren't grouped
    2. Rescans where files were added incrementally
    3. Any orphaned RAW/metadata files that should be attached to existing Photos
    
    Strategy: Find Photos with RAW-only main_file, look for matching JPEG Photos,
    merge the RAW file into the JPEG Photo and delete the RAW-only Photo.
    
    Args:
        user: The user whose photos to repair
        job_id: Job ID for tracking progress
    """
    lrj = LongRunningJob.get_or_create_job(
        user=user,
        job_type=LongRunningJob.JOB_REPAIR_FILE_VARIANTS,
        job_id=job_id,
    )
    
    try:
        # Find Photos where main_file is RAW (potential orphans)
        raw_only_photos = Photo.objects.filter(
            owner=user,
            main_file__type=File.RAW_FILE
        )
        
        lrj.update_progress(current=0, target=raw_only_photos.count())
        
        merged_count = 0
        fixed_main_file_count = 0
        
        for raw_photo in raw_only_photos:
            if not raw_photo.main_file:
                continue
                
            # Check if this RAW photo has any IMAGE files (already grouped)
            has_image = raw_photo.files.filter(type=File.IMAGE).exists()
            if has_image:
                # Already properly grouped, just fix main_file priority
                image_file = raw_photo.files.filter(type=File.IMAGE).first()
                if image_file:
                    raw_photo.main_file = image_file
                    raw_photo.video = False
                    raw_photo.save(update_fields=['main_file', 'video'])
                    fixed_main_file_count += 1
                continue
            
            # Look for matching JPEG Photo
            jpeg_photo = find_matching_jpeg_photo(raw_photo.main_file.path, user)
            if jpeg_photo and jpeg_photo.id != raw_photo.id:
                # Merge: move all files from RAW photo to JPEG photo
                for f in raw_photo.files.all():
                    if not jpeg_photo.files.filter(hash=f.hash).exists():
                        jpeg_photo.files.add(f)
                
                jpeg_photo.save()
                
                # Delete the orphaned RAW-only photo
                raw_photo.delete()
                merged_count += 1
                util.logger.info(
                    f"job {job_id}: Merged RAW photo into JPEG photo {jpeg_photo.image_hash}"
                )
        
        util.logger.info(
            f"job {job_id}: Repaired {merged_count} ungrouped file variants, "
            f"fixed {fixed_main_file_count} main_file priorities"
        )
        lrj.complete()
        
    except Exception as e:
        util.logger.exception(f"job {job_id}: Error repairing file variants: {e}")
        lrj.fail(error=e)
