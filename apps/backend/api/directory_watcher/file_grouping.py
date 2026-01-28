"""
File grouping utilities for the two-phase scan architecture.

This module provides functions for grouping related files (RAW+JPEG pairs,
Live Photos, etc.) so they can be processed together as a single Photo.
"""

import os

from api.models import File, Photo


# JPEG/image extensions that RAW files can be paired with
JPEG_EXTENSIONS = {'.jpg', '.jpeg', '.heic', '.heif', '.png', '.tiff', '.tif'}

# File type priority for main_file selection (lower number = higher priority)
# JPEG/processed images should be main_file, RAW/video variants are secondary
FILE_TYPE_PRIORITY = {
    File.IMAGE: 1,      # JPEG, HEIC, PNG - highest priority
    File.VIDEO: 2,      # Videos (standalone or Live Photo motion)
    File.RAW_FILE: 3,   # RAW files are variants, not main
    File.METADATA_FILE: 4,  # XMP sidecars - lowest priority
    File.UNKNOWN: 5,
}


def get_file_grouping_key(path: str) -> tuple[str, str]:
    """
    Get the grouping key for a file path.
    
    Files with the same (directory, basename) should be grouped together
    as variants of the same Photo (e.g., IMG_001.jpg + IMG_001.CR2 + IMG_001.xmp).
    
    Args:
        path: File path to get grouping key for
        
    Returns:
        Tuple of (directory, lowercase_basename_without_extension)
    """
    directory = os.path.dirname(path)
    basename = os.path.splitext(os.path.basename(path))[0].lower()
    return (directory, basename)


def select_main_file(files: list[File]) -> File | None:
    """
    Select the best file to be the main_file for a Photo.
    
    Priority: IMAGE > VIDEO > RAW > METADATA
    Within same type, prefer the first one found (alphabetically by path).
    
    Args:
        files: List of File objects to choose from
        
    Returns:
        The File that should be main_file, or None if empty list
    """
    if not files:
        return None
    
    return min(files, key=lambda f: (FILE_TYPE_PRIORITY.get(f.type, 999), f.path))


def find_matching_jpeg_photo(raw_path: str, user) -> Photo | None:
    """
    Find an existing Photo with a matching JPEG/image file for a RAW file.
    
    Matches based on same base filename (without extension) in the same directory.
    This implements the PhotoPrism-like file variant model where RAW+JPEG are
    one Photo with multiple file variants, not separate Photos.
    
    Args:
        raw_path: Path to the RAW file
        user: Owner of the photos
        
    Returns:
        Matching Photo if found, None otherwise
    """
    raw_dir = os.path.dirname(raw_path)
    raw_basename = os.path.splitext(os.path.basename(raw_path))[0]
    
    # Look for matching JPEG/image file in same directory
    for jpeg_ext in JPEG_EXTENSIONS:
        # Try both lowercase and uppercase extensions
        for ext in [jpeg_ext, jpeg_ext.upper()]:
            jpeg_path = os.path.join(raw_dir, raw_basename + ext)
            photo = Photo.objects.filter(
                owner=user,
                main_file__path=jpeg_path
            ).first()
            if photo:
                return photo
    
    return None


def find_matching_image_for_video(video_path: str, user) -> Photo | None:
    """
    Find an existing Photo with a matching image file for a Live Photo video.
    
    Apple Live Photos store the video as a separate .mov file with the same
    base name as the image. This allows attaching the video as a file variant.
    
    Args:
        video_path: Path to the video file
        user: Owner of the photos
        
    Returns:
        Matching Photo if found, None otherwise
    """
    video_dir = os.path.dirname(video_path)
    video_basename = os.path.splitext(os.path.basename(video_path))[0]
    video_ext_lower = os.path.splitext(video_path)[1].lower()
    
    # Only match .mov files (Apple Live Photos) with same base name
    if video_ext_lower not in ['.mov']:
        return None
    
    # Look for matching image file with same base name
    image_extensions = list(JPEG_EXTENSIONS) + ['.heic', '.HEIC']
    for img_ext in image_extensions:
        for ext in [img_ext, img_ext.upper()]:
            image_path = os.path.join(video_dir, video_basename + ext)
            photo = Photo.objects.filter(
                owner=user,
                main_file__path=image_path
            ).first()
            if photo:
                return photo
    
    return None
