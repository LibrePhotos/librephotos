"""
Stack detection module for grouping related photos organizationally.

Handles organizational stack types:
- BURST_SEQUENCE: Photos taken in rapid succession
- EXPOSURE_BRACKET: Bracketed exposures for HDR
- MANUAL: User-created stacks (not detected, created by user)

NOTE: RAW+JPEG pairs and Live Photos are NO LONGER handled as stacks.
They now use the Photo.files ManyToMany field for file variants
(PhotoPrism-like model). This is handled during scan, not detection.

NOTE: Duplicate detection (exact copies and visual duplicates) is now
handled separately by api/duplicate_detection.py. This module focuses
on organizational grouping, not storage cleanup.

Burst detection uses a rules-based system with two categories:
- Hard criteria: Deterministic (EXIF tags, filename patterns)
- Soft criteria: Estimation (timestamp proximity, visual similarity)
"""

from collections import defaultdict

from django.db.models import Q

from api.models import Photo
from api.models.photo_stack import PhotoStack
from api.models.long_running_job import LongRunningJob
from api.burst_detection_rules import (
    as_rules,
    get_enabled_rules,
    get_hard_rules,
    get_soft_rules,
    group_photos_by_timestamp,
    group_photos_by_visual_similarity,
    BurstRuleTypes,
)
from api.util import logger


def clear_stacks_of_type(user, stack_type):
    """
    Clear all stacks of a specific type for a user before re-detection.
    This ensures we start fresh and don't create duplicate stacks.
    
    Args:
        user: The user whose stacks to clear
        stack_type: The stack type to clear (e.g., PhotoStack.StackType.BURST_SEQUENCE)
    
    Returns:
        Number of stacks deleted
    """
    stacks_to_delete = PhotoStack.objects.filter(
        owner=user,
        stack_type=stack_type
    )
    
    count = stacks_to_delete.count()
    
    # Unlink all photos from these stacks (ManyToMany)
    for stack in stacks_to_delete:
        for photo in stack.photos.all():
            photo.stacks.remove(stack)
    
    # Delete the stacks
    stacks_to_delete.delete()
    
    if count > 0:
        logger.info(f"Cleared {count} {stack_type} stacks for {user.username}")
    
    return count


def detect_burst_sequences(user, interval_ms=2000, use_visual_similarity=True, progress_callback=None):
    """
    Detect burst sequences using user's configured rules.
    
    This function now uses a rules-based system with two categories:
    - Hard criteria: EXIF tags, filename patterns (deterministic)
    - Soft criteria: Timestamp proximity, visual similarity (estimation)
    
    By default, only hard criteria rules are enabled.
    
    Args:
        user: The user whose photos to analyze
        interval_ms: Default milliseconds between burst photos (for soft rules without config)
        use_visual_similarity: Default for visual similarity (for soft rules without config)
        progress_callback: Optional callback(current, total, found)
        
    Returns:
        Number of stacks created
    """
    # Clear existing burst stacks before re-detection
    clear_stacks_of_type(user, PhotoStack.StackType.BURST_SEQUENCE)
    
    # Get user's burst detection rules
    rules_config = user.burst_detection_rules
    if isinstance(rules_config, str):
        import json
        rules_config = json.loads(rules_config)
    
    rules = as_rules(rules_config)
    enabled_rules = get_enabled_rules(rules)
    
    if not enabled_rules:
        logger.info(f"No burst detection rules enabled for {user.username}")
        return 0
    
    hard_rules = get_hard_rules(rules)
    soft_rules = get_soft_rules(rules)
    
    stacks_created = 0
    
    # === Phase 1: Hard criteria detection ===
    if hard_rules:
        stacks_created += _detect_bursts_hard_criteria(user, hard_rules, progress_callback)
    
    # === Phase 2: Soft criteria detection ===
    if soft_rules:
        stacks_created += _detect_bursts_soft_criteria(
            user, soft_rules, interval_ms, use_visual_similarity, progress_callback
        )
    
    logger.info(f"Burst detection for {user.username}: found {stacks_created} sequences")
    return stacks_created


def _detect_bursts_hard_criteria(user, hard_rules, progress_callback=None):
    """
    Detect bursts using hard criteria (EXIF tags, filename patterns).
    
    These are deterministic rules that identify burst photos based on
    camera metadata or filename conventions.
    """
    from api.util import get_metadata
    
    # Get all photos that could be in bursts
    photos = Photo.objects.filter(
        Q(owner=user)
        & Q(hidden=False)
        & Q(in_trashcan=False)
    ).select_related('main_file', 'metadata')
    
    total = photos.count()
    if total == 0:
        return 0
    
    # Collect required EXIF tags from all rules
    required_tags = set()
    for rule in hard_rules:
        required_tags.update(rule.get_required_exif_tags())
    required_tags = list(required_tags)
    
    # Group photos by burst group_key
    burst_groups = defaultdict(list)
    
    for i, photo in enumerate(photos):
        if not photo.main_file:
            continue
        
        # Get EXIF tags for this photo
        try:
            exif_values = get_metadata(photo.main_file.path, required_tags)
            exif_tags = dict(zip(required_tags, exif_values))
        except Exception as e:
            logger.debug(f"Could not read EXIF for {photo.main_file.path}: {e}")
            exif_tags = {}
        
        # Try each hard rule until one matches
        for rule in hard_rules:
            is_burst, group_key = rule.is_burst_photo(photo, exif_tags)
            if is_burst and group_key:
                burst_groups[group_key].append(photo)
                break  # Photo matched a rule, don't try others
        
        if progress_callback and i % 100 == 0:
            progress_callback(i, total, len(burst_groups))
    
    # Create stacks from groups with 2+ photos
    stacks_created = 0
    for group_key, photos_in_group in burst_groups.items():
        if len(photos_in_group) >= 2:
            # Sort by timestamp if available
            photos_in_group.sort(key=lambda p: p.exif_timestamp or p.added_on)
            stack = _create_burst_stack(user, photos_in_group)
            if stack:
                stacks_created += 1
                logger.debug(f"Created hard-criteria burst stack: {group_key} with {len(photos_in_group)} photos")
    
    logger.info(f"Hard criteria burst detection: found {stacks_created} stacks from {len(burst_groups)} groups")
    return stacks_created


def _detect_bursts_soft_criteria(user, soft_rules, default_interval_ms=2000, 
                                  default_use_visual=True, progress_callback=None):
    """
    Detect bursts using soft criteria (timestamp proximity, visual similarity).
    
    These are estimation-based rules that group photos based on timing
    and/or visual similarity.
    """
    # Get photos ordered by timestamp (needed for proximity detection)
    photos = Photo.objects.filter(
        Q(owner=user)
        & Q(exif_timestamp__isnull=False)
        & Q(hidden=False)
        & Q(in_trashcan=False)
    ).order_by('exif_timestamp').select_related('main_file', 'metadata')
    
    total = photos.count()
    if total < 2:
        return 0
    
    stacks_created = 0
    photos_list = list(photos)
    
    # Process each soft rule
    for rule in soft_rules:
        if rule.rule_type == BurstRuleTypes.TIMESTAMP_PROXIMITY:
            # Get rule-specific parameters or use defaults
            interval_ms = rule.params.get('interval_ms', default_interval_ms)
            require_same_camera = rule.params.get('require_same_camera', True)
            
            groups = group_photos_by_timestamp(photos_list, interval_ms, require_same_camera)
            
            for group in groups:
                # Filter out photos already in burst stacks
                photos_to_stack = [
                    p for p in group
                    if not p.stacks.filter(stack_type=PhotoStack.StackType.BURST_SEQUENCE).exists()
                ]
                if len(photos_to_stack) >= 2:
                    stack = _create_burst_stack(user, photos_to_stack)
                    if stack:
                        stacks_created += 1
        
        elif rule.rule_type == BurstRuleTypes.VISUAL_SIMILARITY:
            similarity_threshold = rule.params.get('similarity_threshold', 15)
            
            groups = group_photos_by_visual_similarity(photos_list, similarity_threshold)
            
            for group in groups:
                # Filter out photos already in burst stacks
                photos_to_stack = [
                    p for p in group
                    if not p.stacks.filter(stack_type=PhotoStack.StackType.BURST_SEQUENCE).exists()
                ]
                if len(photos_to_stack) >= 2:
                    stack = _create_burst_stack(user, photos_to_stack)
                    if stack:
                        stacks_created += 1
    
    logger.info(f"Soft criteria burst detection: found {stacks_created} stacks")
    return stacks_created


def _create_burst_stack(user, photos):
    """Helper to create a burst stack from a list of photos."""
    if len(photos) < 2:
        return None
    
    # Filter out photos that are already in a burst stack to prevent duplicates
    # A photo should only be in one burst stack at a time
    photos_to_stack = [
        photo for photo in photos 
        if not photo.stacks.filter(stack_type=PhotoStack.StackType.BURST_SEQUENCE).exists()
    ]
    
    # If all photos are already stacked, skip
    if len(photos_to_stack) < 2:
        return None
    
    # Use create_or_merge to ensure photos aren't in multiple stacks of the same type
    # Pass sequence timestamps for burst stacks
    stack = PhotoStack.create_or_merge(
        owner=user,
        stack_type=PhotoStack.StackType.BURST_SEQUENCE,
        photos=photos_to_stack,
        sequence_start=photos_to_stack[0].exif_timestamp,
        sequence_end=photos_to_stack[-1].exif_timestamp,
    )
    
    logger.info(f"Created/merged BURST_SEQUENCE stack with {len(photos_to_stack)} photos")
    return stack


def batch_detect_stacks(user, options=None):
    """
    Run batch stack detection for a user.
    
    NOTE: RAW+JPEG pairs and Live Photos are now handled as file variants
    during scan (PhotoPrism-like model), not as stacks here.
    
    Burst detection uses the user's configured burst_detection_rules from their profile.
    
    Args:
        user: The user whose photos to analyze
        options: Dict with detection options:
            - detect_bursts: bool (default: True) - uses user's burst_detection_rules
    """
    if options is None:
        options = {}
    
    detect_bursts = options.get('detect_bursts', True)
    
    # Create long-running job for progress tracking
    job = LongRunningJob.create_job(
        user=user,
        job_type=LongRunningJob.JOB_SCAN_PHOTOS,
        start_now=True,
    )
    
    try:
        total_found = 0
        
        # Detect burst sequences (uses user's burst_detection_rules)
        if detect_bursts:
            def progress_burst(current, total, found):
                job.set_result({"stage": "burst_sequences", "current": current, "total": total, "found": found})
            
            burst_count = detect_burst_sequences(user, progress_callback=progress_burst)
            total_found += burst_count
        
        job.complete(result={"status": "completed", "stacks_found": total_found})
        
        logger.info(f"Stack detection completed for {user.username}: {total_found} stacks found")
        
    except Exception as e:
        logger.error(f"Stack detection failed for {user.username}: {e}")
        job.fail(error=e)
        raise
