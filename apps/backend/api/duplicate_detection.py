"""
Duplicate detection module for finding duplicate photos.

Handles two types of duplicates:
- EXACT_COPY: Files with identical MD5 hash (byte-for-byte copies)
- VISUAL_DUPLICATE: Photos with similar perceptual hash

This is separate from stack detection (RAW+JPEG pairs, bursts, etc.)
because duplicates are about storage cleanup, not photo organization.

Optimized with BK-Tree for efficient visual duplicate detection.
"""

from collections import defaultdict

from django.db.models import Q

from api.models import Photo
from api.models.duplicate import Duplicate
from api.models.file import File
from api.models.long_running_job import LongRunningJob
from api.perceptual_hash import DEFAULT_HAMMING_THRESHOLD, hamming_distance
from api.util import logger


class BKTree:
    """
    Burkhard-Keller Tree for efficient Hamming distance queries.
    
    Achieves O(log n) average case by pruning branches using triangle inequality.
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
        """Find all items within threshold Hamming distance of query."""
        if self.root is None:
            return []
        
        results = []
        candidates = [self.root]
        
        while candidates:
            node = candidates.pop()
            dist = self.distance(query_hash, node["hash"])
            
            if dist <= threshold:
                results.append((node["id"], dist))
            
            min_dist = max(0, dist - threshold)
            max_dist = dist + threshold
            
            for d, child in node["children"].items():
                if min_dist <= d <= max_dist:
                    candidates.append(child)
        
        return results


class UnionFind:
    """Union-Find with path compression and union by rank."""
    
    def __init__(self):
        self.parent = {}
        self.rank = {}
    
    def find(self, x):
        if x not in self.parent:
            self.parent[x] = x
            self.rank[x] = 0
            return x
        if self.parent[x] != x:
            self.parent[x] = self.find(self.parent[x])
        return self.parent[x]
    
    def union(self, x, y):
        px, py = self.find(x), self.find(y)
        if px == py:
            return
        if self.rank[px] < self.rank[py]:
            px, py = py, px
        self.parent[py] = px
        if self.rank[px] == self.rank[py]:
            self.rank[px] += 1
    
    def get_groups(self):
        groups = defaultdict(list)
        for item in self.parent:
            groups[self.find(item)].append(item)
        return [group for group in groups.values() if len(group) > 1]


def detect_exact_copies(user, progress_callback=None):
    """
    Detect exact file copies for a user.
    
    Groups photos that have the same content hash. Uses two methods:
    1. Direct grouping by Photo.image_hash (most reliable)
    2. Grouping by File.hash MD5 part (fallback for edge cases)
    
    Since duplicate files now create separate Photo objects, we group
    photos by their hash to identify exact copies.
    
    Args:
        user: The user whose photos to analyze
        progress_callback: Optional callback(current, total, found) for progress
        
    Returns:
        Number of duplicate groups created
    """
    from collections import defaultdict
    
    # Get all photos with their files, excluding metadata files
    # Exclude removed photos to avoid including merged/deleted duplicates
    photos = Photo.objects.filter(
        Q(owner=user) & Q(hidden=False) & Q(in_trashcan=False) & Q(removed=False)
    ).prefetch_related('files').select_related('main_file')
    
    # Method 1: Group photos directly by Photo.image_hash (simplest and most reliable)
    # Photo.image_hash format is md5 (32 chars) + user_id
    image_hash_to_photos = defaultdict(list)
    
    for photo in photos:
        if photo.image_hash:
            image_hash_to_photos[photo.image_hash].append(photo)
    
    # Method 2: Group photos by File content hash (MD5 only, excluding user_id suffix)
    # File.hash format is md5 (32 chars) + user_id, so extract just the MD5 part
    # This serves as a fallback for edge cases
    file_hash_to_photos = defaultdict(list)
    
    for photo in photos:
        # Get actual files (exclude metadata)
        actual_files = photo.files.exclude(type=File.METADATA_FILE)
        if not actual_files.exists():
            continue
            
        # Extract MD5 from File.hash (first 32 characters)
        # This groups photos with the same content regardless of user_id suffix
        file_hash_full = actual_files.first().hash
        if len(file_hash_full) >= 32:
            content_hash = file_hash_full[:32]  # MD5 is 32 hex characters
            file_hash_to_photos[content_hash].append(photo)
    
    # Filter to only groups with 2+ photos (actual duplicates)
    image_hash_groups = {h: photos for h, photos in image_hash_to_photos.items() if len(photos) > 1}
    file_hash_groups = {h: photos for h, photos in file_hash_to_photos.items() if len(photos) > 1}
    
    # Use Union-Find to merge overlapping groups
    # Photos that appear in both image_hash and file_hash groupings should be in the same duplicate group
    uf = UnionFind()
    
    # Add all photos from image_hash groups to Union-Find
    # Optimized: Union-Find is transitive, so we only need to union each element
    # with the first element in the group. This is O(n) instead of O(n²).
    for image_hash, group_photos in image_hash_groups.items():
        photo_ids = [p.id for p in group_photos]
        if len(photo_ids) >= 2:
            first = photo_ids[0]
            for pid in photo_ids[1:]:
                uf.union(first, pid)

    # Add all photos from file_hash groups to Union-Find
    for file_hash, group_photos in file_hash_groups.items():
        photo_ids = [p.id for p in group_photos]
        if len(photo_ids) >= 2:
            first = photo_ids[0]
            for pid in photo_ids[1:]:
                uf.union(first, pid)
    
    # Get merged groups from Union-Find
    merged_groups = uf.get_groups()
    
    duplicates_created = 0
    total = len(merged_groups)
    
    for i, photo_id_group in enumerate(merged_groups):
        if len(photo_id_group) < 2:
            continue
        
        # Get Photo objects for this group
        group_photos = Photo.objects.filter(id__in=photo_id_group)
        
        # Create or merge duplicate group using the helper method
        duplicate = Duplicate.create_or_merge(
            owner=user,
            duplicate_type=Duplicate.DuplicateType.EXACT_COPY,
            photos=group_photos,
        )
        
        if duplicate:
            duplicates_created += 1
        
        if progress_callback and i % 100 == 0:
            progress_callback(i, total, duplicates_created)
    
    logger.info(f"Exact copy detection for {user.username}: found {duplicates_created} duplicate groups")
    return duplicates_created


def detect_visual_duplicates(user, threshold=DEFAULT_HAMMING_THRESHOLD, progress_callback=None):
    """
    Detect visually similar photos using perceptual hash.
    
    Uses BK-Tree for O(log n) lookups and Union-Find for grouping.
    
    Args:
        user: The user whose photos to analyze
        threshold: Hamming distance threshold (default: 10)
        progress_callback: Optional callback(current, total, found) for progress
        
    Returns:
        Number of duplicate groups created
    """
    # Get photos with perceptual hash that aren't already in visual duplicate groups
    # Exclude removed photos to avoid including merged/deleted duplicates
    photos = Photo.objects.filter(
        Q(owner=user) & 
        Q(hidden=False) & 
        Q(in_trashcan=False) &
        Q(removed=False) &
        Q(perceptual_hash__isnull=False)
    ).exclude(
        duplicates__duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE
    ).values('id', 'perceptual_hash')
    
    total = photos.count()
    if total < 2:
        return 0
    
    logger.info(f"Building BK-Tree for {total} photos (user: {user.username})")
    
    # Build BK-Tree
    bk_tree = BKTree(hamming_distance)
    photo_hashes = {}
    
    for i, photo in enumerate(photos):
        photo_id = photo['id']
        phash = photo['perceptual_hash']
        
        if phash:
            bk_tree.add(photo_id, phash)
            photo_hashes[photo_id] = phash
        
        if progress_callback and i % 1000 == 0:
            progress_callback(i, total * 2, 0)  # First half: building tree
    
    logger.info(f"BK-Tree built with {bk_tree.size} photos")
    
    # Find similar pairs using Union-Find
    uf = UnionFind()
    pairs_found = 0
    
    for i, (photo_id, phash) in enumerate(photo_hashes.items()):
        similar = bk_tree.search(phash, threshold)
        
        for similar_id, distance in similar:
            if similar_id != photo_id:
                uf.union(photo_id, similar_id)
                pairs_found += 1
        
        if progress_callback and i % 1000 == 0:
            progress_callback(total + i, total * 2, pairs_found)  # Second half: searching
    
    # Create duplicate groups from Union-Find groups
    groups = uf.get_groups()
    duplicates_created = 0
    
    for group in groups:
        if len(group) < 2:
            continue
            
        # Get Photo objects for this group
        group_photos = Photo.objects.filter(id__in=group)
        
        # Create or merge duplicate group
        duplicate = Duplicate.create_or_merge(
            owner=user,
            duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE,
            photos=group_photos,
        )
        
        if duplicate:
            duplicates_created += 1
    
    logger.info(f"Visual duplicate detection for {user.username}: found {duplicates_created} groups from {pairs_found} pairs")
    return duplicates_created


def batch_detect_duplicates(user, options=None):
    """
    Run batch duplicate detection for a user.
    
    Args:
        user: The user whose photos to analyze
        options: Dict with detection options:
            - detect_exact_copies: bool (default: True)
            - detect_visual_duplicates: bool (default: True)
            - visual_threshold: int (default: 10)
            - clear_pending: bool (default: False)
    """
    if options is None:
        options = {}
    
    detect_exact = options.get('detect_exact_copies', True)
    detect_visual = options.get('detect_visual_duplicates', True)
    visual_threshold = options.get('visual_threshold', DEFAULT_HAMMING_THRESHOLD)
    clear_pending = options.get('clear_pending', False)
    
    # Create long-running job for progress tracking
    job = LongRunningJob.create_job(
        user=user,
        job_type=LongRunningJob.JOB_DETECT_DUPLICATES,
        start_now=True,
    )
    
    try:
        
        # Clear pending duplicates if requested
        if clear_pending:
            cleared = Duplicate.objects.filter(
                owner=user,
                review_status=Duplicate.ReviewStatus.PENDING
            ).delete()[0]
            logger.info(f"Cleared {cleared} pending duplicates for {user.username}")
        
        total_found = 0
        
        # Detect exact copies
        if detect_exact:
            def progress_exact(current, total, found):
                job.set_result({"stage": "exact_copies", "current": current, "total": total, "found": found})
            
            exact_count = detect_exact_copies(user, progress_exact)
            total_found += exact_count
        
        # Detect visual duplicates
        if detect_visual:
            def progress_visual(current, total, found):
                job.set_result({"stage": "visual_duplicates", "current": current, "total": total, "found": found})
            
            visual_count = detect_visual_duplicates(user, visual_threshold, progress_visual)
            total_found += visual_count
        
        job.complete(result={"status": "completed", "duplicates_found": total_found})
        
        logger.info(f"Duplicate detection completed for {user.username}: {total_found} groups found")
        
    except Exception as e:
        logger.error(f"Duplicate detection failed for {user.username}: {e}")
        job.fail(error=e)
        raise
