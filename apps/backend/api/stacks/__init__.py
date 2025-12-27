"""
Photo stacking detection and management.

This package provides unified photo grouping functionality:
- Exact copies (same MD5 hash)
- Visual duplicates (similar pHash/CLIP)
- RAW+JPEG pairs
- Burst sequences
- Exposure brackets
- Live Photos (embedded motion video)
- Manual user groupings
"""

from api.stacks.live_photo import (
    detect_live_photo,
    extract_embedded_motion_video,
    find_apple_live_photo_video,
    has_embedded_motion_video,
    process_live_photos_batch,
)

__all__ = [
    "detect_live_photo",
    "extract_embedded_motion_video",
    "find_apple_live_photo_video",
    "has_embedded_motion_video",
    "process_live_photos_batch",
]
