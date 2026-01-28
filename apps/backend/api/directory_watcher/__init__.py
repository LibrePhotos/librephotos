"""
Directory watcher module for scanning and processing photos.

This module implements a two-phase scan architecture to avoid race conditions
when processing RAW+JPEG pairs concurrently:

Phase 1: Collect all files and group by (directory, basename)
         - IMG_001.jpg, IMG_001.CR2, IMG_001.xmp -> one group
         - IMG_002.jpg -> separate group

Phase 2: Process each group, creating one Photo per group
         with all file variants attached.
"""

# Main scan functions
from api.directory_watcher.scan_jobs import (
    scan_photos,
    scan_missing_photos,
    photo_scanner,
)

# File handling
from api.directory_watcher.file_handlers import (
    create_new_image,
    create_file_record,
    group_files_into_photo,
    handle_new_image,
    handle_file_group,
)

# File grouping utilities
from api.directory_watcher.file_grouping import (
    JPEG_EXTENSIONS,
    FILE_TYPE_PRIORITY,
    get_file_grouping_key,
    select_main_file,
    find_matching_jpeg_photo,
    find_matching_image_for_video,
)

# Processing jobs
from api.directory_watcher.processing_jobs import (
    generate_tags,
    generate_tag_job,
    add_geolocation,
    geolocation_job,
    scan_faces,
    generate_face_embeddings,
)

# Repair jobs
from api.directory_watcher.repair_jobs import (
    repair_ungrouped_file_variants,
)

# Utilities
from api.directory_watcher.utils import (
    is_hidden,
    should_skip,
    walk_directory,
    walk_files,
    update_scan_counter,
)

# Re-export from api.models.file for backwards compatibility
from api.models.file import is_valid_media

__all__ = [
    # Scan jobs
    "scan_photos",
    "scan_missing_photos",
    "photo_scanner",
    # File handling
    "create_new_image",
    "create_file_record",
    "group_files_into_photo",
    "handle_new_image",
    "handle_file_group",
    # File grouping
    "JPEG_EXTENSIONS",
    "FILE_TYPE_PRIORITY",
    "get_file_grouping_key",
    "select_main_file",
    "find_matching_jpeg_photo",
    "find_matching_image_for_video",
    # Processing jobs
    "generate_tags",
    "generate_tag_job",
    "add_geolocation",
    "geolocation_job",
    "scan_faces",
    "generate_face_embeddings",
    # Repair jobs
    "repair_ungrouped_file_variants",
    # Utilities
    "is_hidden",
    "should_skip",
    "walk_directory",
    "walk_files",
    "update_scan_counter",
    # Re-exported from api.models.file
    "is_valid_media",
]
