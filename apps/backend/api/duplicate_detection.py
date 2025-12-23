"""
Duplicate detection module for finding and grouping visually similar photos.

Uses perceptual hashing (pHash) to identify duplicate images across different
qualities, formats, and minor crops.

Optimized with BK-Tree for O(n log n) comparison instead of O(n²).
"""

import uuid
from collections import defaultdict
from datetime import datetime

import pytz
from django.db.models import Q

from api.models import Photo
from api.models.duplicate_group import DuplicateGroup
from api.models.long_running_job import LongRunningJob
from api.perceptual_hash import DEFAULT_HAMMING_THRESHOLD, hamming_distance
from api.util import logger


class BKTree:
    """
    Burkhard-Keller Tree for efficient Hamming distance queries.
    
    This data structure is specifically optimized for finding all items
    within a given edit/Hamming distance threshold. Instead of O(n) per query,
    it achieves O(log n) average case by pruning branches that can't contain matches.
    
    For duplicate detection with n photos:
    - Naive O(n²): 8849 photos = ~39 million comparisons
    - BK-Tree O(n log n): 8849 photos = ~115,000 comparisons (estimated)
    """
    
    def __init__(self, distance_func):
        self.distance = distance_func
        self.root = None
        self.size = 0
    
    def add(self, item_id, item_hash):
        """Add an item (id, hash) to the tree."""
        self.size += 1
        if self.root is None:
            self.root = {"id": item_id, "hash": item_hash, "children": {}}
            return
        
        node = self.root
        while True:
            dist = self.distance(item_hash, node["hash"])
            if dist in node["children"]:
                node = node["children"][dist]
            else:
                node["children"][dist] = {"id": item_id, "hash": item_hash, "children": {}}
                break
    
    def search(self, query_hash, threshold):
        """
        Find all items within threshold Hamming distance of query.
        
        Uses the triangle inequality to prune branches:
        If |d(query, node) - d(node, child)| > threshold, skip that child.
        """
        if self.root is None:
            return []
        
        results = []
        candidates = [self.root]
        
        while candidates:
            node = candidates.pop()
            dist = self.distance(query_hash, node["hash"])
            
            if dist <= threshold:
                results.append((node["id"], dist))
            
            # Only explore children within the possible range
            # Triangle inequality: if d(q,n) = dist, then for any child c with d(n,c) = d,
            # we have: dist - d <= d(q,c) <= dist + d
            # So we only need children where: d >= dist - threshold AND d <= dist + threshold
            min_dist = max(0, dist - threshold)
            max_dist = dist + threshold
            
            for d, child in node["children"].items():
                if min_dist <= d <= max_dist:
                    candidates.append(child)
        
        return results


def find_duplicate_groups(
    user,
    threshold: int = DEFAULT_HAMMING_THRESHOLD,
    include_existing_groups: bool = False,
    progress_callback=None,
) -> list[list[str]]:
    """
    Find groups of duplicate photos for a user based on perceptual hash similarity.

    Uses BK-Tree for O(n log n) comparison and Union-Find for clustering.

    Args:
        user: The user whose photos to analyze
        threshold: Maximum Hamming distance to consider as duplicates
        include_existing_groups: If True, include photos already in duplicate groups
        progress_callback: Optional callback(current, total, duplicates_found) for progress updates

    Returns:
        List of lists, where each inner list contains image_hashes of duplicate photos
    """
    # Get all photos with perceptual hashes
    photos_query = Photo.objects.filter(
        Q(owner=user) & Q(perceptual_hash__isnull=False) & Q(hidden=False) & Q(in_trashcan=False)
    )

    if not include_existing_groups:
        photos_query = photos_query.filter(duplicate_group__isnull=True)

    photos = list(
        photos_query.values_list("image_hash", "perceptual_hash").order_by("image_hash")
    )

    n = len(photos)
    if n < 2:
        return []

    # Union-Find data structure for clustering
    parent = {photo[0]: photo[0] for photo in photos}
    duplicates_found = 0

    def find(x):
        if parent[x] != x:
            parent[x] = find(parent[x])  # Path compression
        return parent[x]

    def union(x, y):
        nonlocal duplicates_found
        px, py = find(x), find(y)
        if px != py:
            parent[px] = py
            duplicates_found += 1
            return True
        return False

    # Build BK-Tree for efficient similarity search - O(n log n) instead of O(n²)
    logger.info(f"Building BK-Tree for {n} photos...")
    tree = BKTree(hamming_distance)
    
    last_progress_update = 0
    
    for i, (image_hash, phash) in enumerate(photos):
        # Search for similar photos already in the tree
        matches = tree.search(phash, threshold)
        
        # Union this photo with all its matches
        for match_hash, _ in matches:
            union(image_hash, match_hash)
        
        # Add this photo to the tree for future comparisons
        tree.add(image_hash, phash)
        
        # Report progress
        if progress_callback and (i - last_progress_update >= max(1, n // 100) or i == n - 1):
            progress_callback(i + 1, n, duplicates_found)
            last_progress_update = i

    logger.info(f"BK-Tree search complete. Found {duplicates_found} duplicate pairs.")

    # Group photos by their root parent
    groups = defaultdict(list)
    for image_hash, _ in photos:
        root = find(image_hash)
        groups[root].append(image_hash)

    # Return only groups with more than one photo (actual duplicates)
    return [group for group in groups.values() if len(group) > 1]


def create_duplicate_groups_for_user(user, threshold: int = DEFAULT_HAMMING_THRESHOLD, progress_callback=None):
    """
    Detect duplicates and create DuplicateGroup instances for a user.

    Args:
        user: The user whose photos to analyze
        threshold: Maximum Hamming distance for duplicates
        progress_callback: Optional callback for progress updates

    Returns:
        Number of duplicate groups created
    """
    duplicate_sets = find_duplicate_groups(user, threshold, progress_callback=progress_callback)

    groups_created = 0
    for image_hashes in duplicate_sets:
        # Create a new duplicate group
        group = DuplicateGroup.objects.create(owner=user)

        # Add photos to the group
        Photo.objects.filter(image_hash__in=image_hashes).update(duplicate_group=group)

        # Auto-select the highest quality photo as preferred
        group.auto_select_preferred()

        groups_created += 1
        logger.info(
            f"Created duplicate group {group.id} with {len(image_hashes)} photos for user {user.username}"
        )

    return groups_created


def batch_detect_duplicates(user, threshold: int = DEFAULT_HAMMING_THRESHOLD, clear_existing: bool = False):
    """
    Background job to detect duplicates for a user.
    Creates a LongRunningJob to track progress.
    
    Args:
        user: The user whose photos to analyze
        threshold: Maximum Hamming distance for duplicates (1-20, default 10)
        clear_existing: If True, clear existing pending duplicate groups before detection
    """
    import os
    from api.perceptual_hash import calculate_hash_from_thumbnail
    
    job_id = uuid.uuid4()
    lrj = LongRunningJob.objects.create(
        started_by=user,
        job_id=job_id,
        queued_at=datetime.now().replace(tzinfo=pytz.utc),
        job_type=LongRunningJob.JOB_DETECT_DUPLICATES,
    )
    lrj.started_at = datetime.now().replace(tzinfo=pytz.utc)
    lrj.progress_step = "Initializing..."
    lrj.result = {
        "threshold": threshold,
        "clear_existing": clear_existing,
        "photos_analyzed": 0,
        "hashes_calculated": 0,
        "groups_found": 0,
        "cleared_groups": 0,
    }
    lrj.save()

    try:
        # Step 1: Clear existing pending groups if requested
        if clear_existing:
            lrj.progress_step = "Clearing existing pending groups..."
            lrj.save()
            
            pending_groups = DuplicateGroup.objects.filter(
                owner=user, status=DuplicateGroup.Status.PENDING
            )
            deleted_count = pending_groups.count()
            Photo.objects.filter(duplicate_group__in=pending_groups).update(duplicate_group=None)
            pending_groups.delete()
            
            lrj.result["cleared_groups"] = deleted_count
            lrj.save()
            logger.info(f"Cleared {deleted_count} pending duplicate groups for {user.username}")

        # Step 2: Count photos that need hash calculation
        photos_without_hash = Photo.objects.filter(
            Q(owner=user) & Q(perceptual_hash__isnull=True) & Q(hidden=False)
        ).select_related("thumbnail")
        
        photos_to_hash_count = photos_without_hash.count()
        
        # Count total photos for analysis
        total_photos = Photo.objects.filter(
            Q(owner=user) & Q(hidden=False) & Q(in_trashcan=False)
        ).count()
        
        lrj.result["total_photos"] = total_photos
        lrj.result["photos_needing_hash"] = photos_to_hash_count
        
        if photos_to_hash_count > 0:
            lrj.progress_step = f"Calculating hashes for {photos_to_hash_count} photos..."
            lrj.progress_target = photos_to_hash_count
            lrj.progress_current = 0
            lrj.save()

            hashes_calculated = 0
            for i, photo in enumerate(photos_without_hash):
                try:
                    if (
                        hasattr(photo, "thumbnail")
                        and photo.thumbnail.thumbnail_big
                        and os.path.exists(photo.thumbnail.thumbnail_big.path)
                    ):
                        phash = calculate_hash_from_thumbnail(photo.thumbnail.thumbnail_big.path)
                        if phash:
                            photo.perceptual_hash = phash
                            photo.save(update_fields=["perceptual_hash"])
                            hashes_calculated += 1
                except Exception as e:
                    logger.error(f"Error calculating hash for {photo.image_hash}: {e}")

                lrj.progress_current = i + 1
                lrj.result["hashes_calculated"] = hashes_calculated
                # Update every 10 photos to reduce DB writes
                if (i + 1) % 10 == 0 or i + 1 == photos_to_hash_count:
                    lrj.save()

        # Step 3: Count photos with hashes for comparison
        photos_with_hash = Photo.objects.filter(
            Q(owner=user) & Q(perceptual_hash__isnull=False) & Q(hidden=False) & Q(in_trashcan=False)
        )
        
        if not clear_existing:
            photos_with_hash = photos_with_hash.filter(duplicate_group__isnull=True)
        
        photos_to_analyze = photos_with_hash.count()
        lrj.result["photos_to_compare"] = photos_to_analyze
        
        if photos_to_analyze < 2:
            lrj.progress_step = "Not enough photos to compare"
            lrj.finished = True
            lrj.finished_at = datetime.now().replace(tzinfo=pytz.utc)
            lrj.save()
            return 0
        
        # Step 4: Find duplicates with progress callback (using optimized BK-Tree)
        lrj.progress_step = f"Building BK-Tree for {photos_to_analyze} photos..."
        lrj.progress_current = 0
        lrj.progress_target = photos_to_analyze
        lrj.result["algorithm"] = "BK-Tree (O(n log n))"
        lrj.save()

        def progress_callback(current, total, duplicates_found):
            """Update LRJ progress during comparison phase."""
            lrj.progress_current = current
            lrj.progress_target = total
            lrj.result["comparison_progress"] = current
            lrj.result["duplicates_found_so_far"] = duplicates_found
            percent = int(current / total * 100) if total > 0 else 0
            lrj.progress_step = f"Comparing photos... {percent}% ({current}/{total})"
            lrj.save()

        # Now find and create duplicate groups with the specified threshold
        groups_created = create_duplicate_groups_for_user(user, threshold=threshold, progress_callback=progress_callback)
        
        lrj.result["groups_found"] = groups_created
        lrj.result["photos_analyzed"] = photos_to_analyze

        # Step 5: Complete
        lrj.progress_step = f"Complete! Found {groups_created} duplicate groups"
        lrj.progress_current = photos_to_analyze
        lrj.finished = True
        lrj.finished_at = datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()

        logger.info(
            f"Duplicate detection completed for {user.username}: {groups_created} groups created (threshold={threshold})"
        )
        return groups_created

    except Exception as e:
        logger.exception(f"Error during duplicate detection for {user.username}: {e}")
        lrj.progress_step = f"Error: {str(e)[:80]}"
        lrj.finished = True
        lrj.failed = True
        lrj.finished_at = datetime.now().replace(tzinfo=pytz.utc)
        lrj.save()
        raise


def resolve_duplicate_group(group: DuplicateGroup, keep_photo_hash: str, trash_others: bool = True):
    """
    Resolve a duplicate group by keeping one photo and optionally trashing others.

    Args:
        group: The DuplicateGroup to resolve
        keep_photo_hash: The image_hash of the photo to keep
        trash_others: If True, move other photos to trash

    Returns:
        Number of photos moved to trash
    """
    # Set the preferred photo
    preferred = Photo.objects.filter(image_hash=keep_photo_hash).first()
    if not preferred:
        raise ValueError(f"Photo {keep_photo_hash} not found")

    group.preferred_photo = preferred
    group.status = DuplicateGroup.Status.REVIEWED
    group.save()

    trashed_count = 0
    if trash_others:
        # Move all other photos in the group to trash
        other_photos = group.photos.exclude(image_hash=keep_photo_hash)
        for photo in other_photos:
            photo.in_trashcan = True
            photo.save(update_fields=["in_trashcan"])
            trashed_count += 1

    logger.info(
        f"Resolved duplicate group {group.id}: kept {keep_photo_hash}, trashed {trashed_count} photos"
    )
    return trashed_count


def dismiss_duplicate_group(group: DuplicateGroup):
    """
    Dismiss a duplicate group, marking it as 'not duplicates'.
    Photos remain but are no longer grouped.

    Args:
        group: The DuplicateGroup to dismiss
    """
    group.status = DuplicateGroup.Status.DISMISSED
    group.save()

    # Remove photos from the group
    group.photos.update(duplicate_group=None)

    logger.info(f"Dismissed duplicate group {group.id}")


def calculate_missing_hashes(user, progress_callback=None):
    """
    Calculate perceptual hashes for all photos that don't have one yet.
    
    This is useful for existing photos that were scanned before pHash was added.
    
    Args:
        user: The user whose photos to process
        progress_callback: Optional callback(current, total) for progress updates
        
    Returns:
        Number of photos processed
    """
    import os
    from api.perceptual_hash import calculate_hash_from_thumbnail
    
    photos = Photo.objects.filter(
        owner=user,
        perceptual_hash__isnull=True,
        hidden=False,
        in_trashcan=False,
    ).select_related("thumbnail")
    
    # Also include photos with empty string hashes
    photos = photos | Photo.objects.filter(
        owner=user,
        perceptual_hash="",
        hidden=False,
        in_trashcan=False,
    ).select_related("thumbnail")
    
    total = photos.count()
    processed = 0
    
    for photo in photos.iterator():
        try:
            thumbnail = getattr(photo, "thumbnail", None)
            if thumbnail and thumbnail.thumbnail_big and os.path.exists(thumbnail.thumbnail_big.path):
                phash = calculate_hash_from_thumbnail(thumbnail.thumbnail_big.path)
                if phash:
                    photo.perceptual_hash = phash
                    photo.save(update_fields=["perceptual_hash"])
                    processed += 1
        except Exception as e:
            logger.warning(f"Could not calculate pHash for {photo.image_hash}: {e}")
            
        if progress_callback:
            progress_callback(processed, total)
    
    logger.info(f"Calculated perceptual hashes for {processed}/{total} photos for user {user.username}")
    return processed
