"""
Duplicate detection module for finding duplicate photos.

Handles two types of duplicates:
- EXACT_COPY: Files with identical MD5 hash (byte-for-byte copies)
- VISUAL_DUPLICATE: Photos with similar perceptual hash

This is separate from stack detection (RAW+JPEG pairs, bursts, etc.)
because duplicates are about storage cleanup, not photo organization.

- detect_exact_copies: Uses database aggregation (GROUP BY) instead of loading
  all photos into memory. Only photo IDs are loaded, not full objects.
- detect_visual_duplicates: compares every pair of 64-bit perceptual hashes
  in numpy (XOR + population count, ~32 MB per step) and groups them with
  union-find; other hash lengths go through a BK-tree.
"""

import logging
from collections import defaultdict

from django.db.models import Q

from api.lazy_import import LazyModule
from api.models import Photo
from api.models.duplicate import Duplicate
from api.models.file import File
from api.models.long_running_job import LongRunningJob
from api.perceptual_hash import (
    DEFAULT_HAMMING_THRESHOLD,
    HEX64_HASH,
    hamming_distance,
)

np = LazyModule("numpy")

logger = logging.getLogger(__name__)


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
        Photo.objects.owned_by(user)
        .filter(
            Q(hidden=False)
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
            INNER JOIN api_photo_files pf ON pf.file_id = f.hash
            INNER JOIN api_photo p ON p.id = pf.photo_id
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
            Photo.objects.owned_by(user)
            .filter(
                image_hash=image_hash,
                hidden=False,
                in_trashcan=False,
                removed=False,
            )
            .values_list("id", flat=True)
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
            Photo.objects.owned_by(user)
            .filter(
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


# Comparisons per numpy step (rows x all later hashes): ~32 MB of uint64.
_PAIR_BLOCK_ELEMENTS = 4_000_000


def _hash_ints(hashes):
    """The hashes as ints, or None unless every one is a 64-bit (16 hex digit) hash."""
    if not all(HEX64_HASH.fullmatch(value) for value in hashes):
        return None
    return [int(value, 16) for value in hashes]


def _popcount(values):
    if hasattr(np, "bitwise_count"):  # numpy >= 2.0
        return np.bitwise_count(values)
    as_bytes = values.view(np.uint8).reshape(values.shape + (8,))
    return np.unpackbits(as_bytes, axis=-1).sum(axis=-1)


def similar_pairs(hashes, threshold):
    """Index pairs ``(i, j)``, ``i < j``, of hashes at most *threshold* bits apart.

    Every pair is compared, so the result is exact for any threshold, but in
    numpy: an XOR and a population count per pair, against two imagehash
    objects per pair before (~75 us, about a day for 50k photos; the Rust
    experiment got the same groups in seconds). Returns None when a hash is
    not 64 bits; :func:`_similar_pairs_bktree` handles those.
    """
    ints = _hash_ints(hashes)
    if ints is None:
        return None
    values = np.array(ints, dtype=np.uint64)
    n = len(values)
    rows = max(1, _PAIR_BLOCK_ELEMENTS // max(n, 1))
    pairs = []
    for start in range(0, n, rows):
        block = values[start : start + rows]
        # Columns from the block's first row on: every later hash once.
        distances = _popcount(np.bitwise_xor(block[:, None], values[None, start:]))
        i, j = np.nonzero(distances <= threshold)
        i += start
        j += start
        keep = j > i
        pairs.extend(zip(i[keep].tolist(), j[keep].tolist()))
    return pairs


def _similar_pairs_bktree(hashes, threshold):
    """:func:`similar_pairs` for hashes of any length, through a BK-tree."""
    tree = BKTree(hamming_distance)
    for index, phash in enumerate(hashes):
        tree.add(index, phash)
    pairs = []
    for index, phash in enumerate(hashes):
        for other, _distance in tree.search(phash, threshold):
            if other > index:
                pairs.append((index, other))
    return pairs


def detect_visual_duplicates(
    user, threshold=DEFAULT_HAMMING_THRESHOLD, progress_callback=None, batch_size=10000
):
    """
    Detect visually similar photos using perceptual hash.

    Loads every candidate's (id, hash), finds all pairs within *threshold*
    bits (:func:`similar_pairs`, numpy) and groups them with union-find, so a
    group is a connected component of similar photos.

    Args:
        user: The user whose photos to analyze
        threshold: Hamming distance threshold (default: 10)
        progress_callback: Optional callback(current, total, found) for progress
        batch_size: Unused; kept for callers

    Returns:
        Number of duplicate groups created
    """
    # Get photos with perceptual hash that aren't already in visual duplicate groups
    # Exclude removed photos to avoid including merged/deleted duplicates
    photos_queryset = (
        Photo.objects.owned_by(user)
        .filter(
            Q(hidden=False)
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

    logger.info(f"Processing {total} photos (user: {user.username})")

    # Every photo's (id, hash); ~30 bytes each, so 300k photos stay in the
    # tens of MB. One query: slicing the unordered queryset in batches gave
    # Postgres no order to page by.
    all_photo_hashes = [
        (photo_id, phash)
        for photo_id, phash in photos_queryset.values_list("id", "perceptual_hash")
        if phash
    ]
    hashes = [phash for _, phash in all_photo_hashes]
    if progress_callback:
        progress_callback(total // 2, total, 0)

    pairs = similar_pairs(hashes, threshold)
    if pairs is None:
        logger.info("Perceptual hashes of other lengths: comparing them one by one")
        pairs = _similar_pairs_bktree(hashes, threshold)

    uf = UnionFind()
    for i, j in pairs:
        uf.union(all_photo_hashes[i][0], all_photo_hashes[j][0])
    pairs_found = len(pairs)
    if progress_callback:
        progress_callback(total, total, pairs_found)
    logger.info(f"Found {pairs_found} similar pairs among {len(hashes)} photos")

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
