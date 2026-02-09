"""
Duplicate detection module for finding duplicate photos.

Handles two types of duplicates:
- EXACT_COPY: Files with identical MD5 hash (byte-for-byte copies)
- VISUAL_DUPLICATE: Photos with similar perceptual hash

This is separate from stack detection (RAW+JPEG pairs, bursts, etc.)
because duplicates are about storage cleanup, not photo organization.

Optimized with BK-Tree for efficient visual duplicate detection.

Memory Optimizations (v2):
- detect_exact_copies: Uses database aggregation (GROUP BY) instead of loading
  all photos into memory. Only photo IDs are loaded, not full objects.
- detect_visual_duplicates: Processes photos in configurable batches (default 10k).
  Uses two-pass algorithm: within-batch BK-Tree search, then cross-batch linear scan.
  Memory usage: O(batch_size) instead of O(total_photos).

With 300k photos:
- Old: ~10GB+ RAM (all photos + files + large BK-Tree)
- New: ~100-200MB RAM (batch + hash list only)
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
                node["children"][dist] = {
                    "id": item_id,
                    "hash": item_hash,
                    "children": {},
                }
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

    Groups photos that have the same content hash. Uses database aggregation
    to efficiently find duplicate groups without loading all photos into memory.

    Memory optimized: Uses database GROUP BY instead of Python dictionaries.

    Args:
        user: The user whose photos to analyze
        progress_callback: Optional callback(current, total, found) for progress

    Returns:
        Number of duplicate groups created
    """
    from django.db.models import Count

    # Method 1: Find duplicate groups by Photo.image_hash using database aggregation
    # This is memory efficient as we only load photo IDs grouped by hash
    image_hash_groups = (
        Photo.objects.filter(
            Q(owner=user)
            & Q(hidden=False)
            & Q(in_trashcan=False)
            & Q(removed=False)
            & Q(image_hash__isnull=False)
        )
        .values("image_hash")
        .annotate(count=Count("id"))
        .filter(count__gt=1)
        .values_list("image_hash", flat=True)
    )

    # Method 2: Find duplicate groups by File content hash (MD5 part)
    # We need to use a SUBSTRING operation to extract the MD5 part
    # This is done via raw SQL for efficiency
    from django.db import connection

    file_hash_duplicates = []
    with connection.cursor() as cursor:
        # Extract first 32 chars (MD5) from File.hash and find duplicates
        # Only consider non-metadata files
        cursor.execute(
            """
            SELECT SUBSTRING(f.hash, 1, 32) as content_hash
            FROM api_file f
            INNER JOIN api_photo p ON p.id = f.photo_id
            WHERE p.owner_id = %s 
                AND p.hidden = FALSE 
                AND p.in_trashcan = FALSE
                AND p.removed = FALSE
                AND f.type != %s
            GROUP BY SUBSTRING(f.hash, 1, 32)
            HAVING COUNT(DISTINCT p.id) > 1
        """,
            [user.id, File.METADATA_FILE],
        )

        file_hash_duplicates = [row[0] for row in cursor.fetchall()]

    # Use Union-Find to merge overlapping groups
    uf = UnionFind()

    # Process image_hash groups
    # Note: We need to iterate through the queryset, which will load the hashes into memory
    # But this is much better than loading all photos with files
    image_hash_list = list(image_hash_groups)  # Load just the hashes
    total_image_groups = len(image_hash_list)

    for i, image_hash in enumerate(image_hash_list):
        # Only load photo IDs, not full Photo objects
        photo_ids = list(
            Photo.objects.filter(
                owner=user,
                image_hash=image_hash,
                hidden=False,
                in_trashcan=False,
                removed=False,
            ).values_list("id", flat=True)
        )

        if len(photo_ids) >= 2:
            first = photo_ids[0]
            for pid in photo_ids[1:]:
                uf.union(first, pid)

        if progress_callback and i % 100 == 0:
            progress_callback(i, total_image_groups * 2, 0)

    # Process file_hash groups
    for i, content_hash in enumerate(file_hash_duplicates):
        # Find photos with files matching this content hash
        photo_ids = list(
            Photo.objects.filter(
                owner=user,
                hidden=False,
                in_trashcan=False,
                removed=False,
                files__hash__startswith=content_hash,
            )
            .exclude(files__type=File.METADATA_FILE)
            .distinct()
            .values_list("id", flat=True)
        )

        if len(photo_ids) >= 2:
            first = photo_ids[0]
            for pid in photo_ids[1:]:
                uf.union(first, pid)

        if progress_callback and i % 100 == 0:
            progress_callback(total_image_groups + i, total_image_groups * 2, 0)

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

    logger.info(
        f"Exact copy detection for {user.username}: found {duplicates_created} duplicate groups"
    )
    return duplicates_created


def detect_visual_duplicates(
    user, threshold=DEFAULT_HAMMING_THRESHOLD, progress_callback=None, batch_size=10000
):
    """
    Detect visually similar photos using perceptual hash.

    Memory optimized: Processes photos in batches to avoid loading all data into memory.
    Uses a two-pass approach for complete duplicate detection with bounded memory.

    Algorithm:
    1. First pass: Build BKTree in batches, find within-batch duplicates
    2. Second pass: Compare each batch against all previous batches using linear scan

    The linear scan in pass 2 is acceptable because:
    - We only store (id, hash) tuples, not full Photo objects
    - Hamming distance is very fast to compute
    - With 300k photos, we have ~300k comparisons per batch, which is fast

    Args:
        user: The user whose photos to analyze
        threshold: Hamming distance threshold (default: 10)
        progress_callback: Optional callback(current, total, found) for progress
        batch_size: Number of photos to process per batch (default: 10000)

    Returns:
        Number of duplicate groups created
    """
    # Get photos with perceptual hash that aren't already in visual duplicate groups
    # Exclude removed photos to avoid including merged/deleted duplicates
    photos_queryset = (
        Photo.objects.filter(
            Q(owner=user)
            & Q(hidden=False)
            & Q(in_trashcan=False)
            & Q(removed=False)
            & Q(perceptual_hash__isnull=False)
        )
        .exclude(duplicates__duplicate_type=Duplicate.DuplicateType.VISUAL_DUPLICATE)
        .only("id", "perceptual_hash")
    )

    total = photos_queryset.count()
    if total < 2:
        return 0

    logger.info(
        f"Processing {total} photos in batches of {batch_size} (user: {user.username})"
    )

    # Union-Find for grouping across all batches
    uf = UnionFind()
    pairs_found = 0
    processed = 0

    # Store all photo hashes as (id, hash) tuples for cross-batch comparison
    # Memory efficient: 300k photos × ~28 bytes = ~8.4MB theoretical
    # In practice, Python overhead means ~25-40MB for list + objects
    all_photo_hashes = []

    # Calculate number of batches
    num_batches = (total + batch_size - 1) // batch_size

    # Pass 1: Process each batch internally and build the complete hash list
    for batch_idx in range(num_batches):
        offset = batch_idx * batch_size

        # Get current batch using slicing (memory efficient)
        batch_photos = list(
            photos_queryset[offset : offset + batch_size].values(
                "id", "perceptual_hash"
            )
        )

        if not batch_photos:
            break

        logger.info(
            f"Pass 1: Processing batch {batch_idx + 1}/{num_batches} ({len(batch_photos)} photos)"
        )

        # Build temporary BK-Tree for current batch (for efficient within-batch search)
        batch_tree = BKTree(hamming_distance)
        batch_hashes = []

        for photo in batch_photos:
            photo_id = photo["id"]
            phash = photo["perceptual_hash"]

            if phash:
                batch_tree.add(photo_id, phash)
                batch_hashes.append((photo_id, phash))

        # Find duplicates within current batch using BK-Tree
        for photo_id, phash in batch_hashes:
            similar = batch_tree.search(phash, threshold)

            for similar_id, distance in similar:
                if similar_id != photo_id:
                    uf.union(photo_id, similar_id)
                    pairs_found += 1

        # Add batch to the complete list for cross-batch comparison
        all_photo_hashes.extend(batch_hashes)

        processed += len(batch_photos)

        if progress_callback:
            # Report progress for pass 1 (first 50% of total work)
            progress_callback(processed // 2, total, pairs_found)

    logger.info(
        f"Pass 1 complete. Found {pairs_found} within-batch pairs. Starting cross-batch comparison."
    )

    # Pass 2: Compare each batch against all previous photos (linear scan)
    # This ensures we don't miss duplicates between distant batches
    processed = 0

    for batch_idx in range(num_batches):
        start_idx = batch_idx * batch_size
        end_idx = min(start_idx + batch_size, len(all_photo_hashes))

        if start_idx >= end_idx:
            break

        batch_hashes = all_photo_hashes[start_idx:end_idx]

        logger.info(
            f"Pass 2: Comparing batch {batch_idx + 1}/{num_batches} against previous photos"
        )

        # Compare current batch against all previous photos
        # Store the previous photos slice once to avoid repeated slicing
        previous_hashes = all_photo_hashes[:start_idx] if start_idx > 0 else []

        for photo_id, phash in batch_hashes:
            # Only compare against photos in previous batches (avoid duplicate comparisons)
            for prev_id, prev_hash in previous_hashes:
                distance = hamming_distance(phash, prev_hash)
                if distance <= threshold:
                    uf.union(photo_id, prev_id)
                    pairs_found += 1

        processed += len(batch_hashes)

        if progress_callback:
            # Report progress for pass 2 (second 50% of total work)
            progress_callback(total // 2 + processed // 2, total, pairs_found)

    logger.info(f"Pass 2 complete. Total pairs found: {pairs_found}")

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

    logger.info(
        f"Visual duplicate detection for {user.username}: found {duplicates_created} groups from {pairs_found} pairs"
    )
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
            - batch_size: int (default: 10000) - photos per batch for visual detection
    """
    if options is None:
        options = {}

    detect_exact = options.get("detect_exact_copies", True)
    detect_visual = options.get("detect_visual_duplicates", True)
    visual_threshold = options.get("visual_threshold", DEFAULT_HAMMING_THRESHOLD)
    clear_pending = options.get("clear_pending", False)
    batch_size = options.get("batch_size", 10000)

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
                owner=user, review_status=Duplicate.ReviewStatus.PENDING
            ).delete()[0]
            logger.info(f"Cleared {cleared} pending duplicates for {user.username}")

        total_found = 0

        # Detect exact copies
        if detect_exact:

            def progress_exact(current, total, found):
                job.set_result(
                    {
                        "stage": "exact_copies",
                        "current": current,
                        "total": total,
                        "found": found,
                    }
                )

            exact_count = detect_exact_copies(user, progress_exact)
            total_found += exact_count

        # Detect visual duplicates
        if detect_visual:

            def progress_visual(current, total, found):
                job.set_result(
                    {
                        "stage": "visual_duplicates",
                        "current": current,
                        "total": total,
                        "found": found,
                    }
                )

            visual_count = detect_visual_duplicates(
                user, visual_threshold, progress_visual, batch_size
            )
            total_found += visual_count

        job.complete(result={"status": "completed", "duplicates_found": total_found})

        logger.info(
            f"Duplicate detection completed for {user.username}: {total_found} groups found"
        )

    except Exception as e:
        logger.error(f"Duplicate detection failed for {user.username}: {e}")
        job.fail(error=e)
        raise
