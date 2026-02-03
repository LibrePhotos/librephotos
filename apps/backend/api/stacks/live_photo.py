"""
Live Photo detection and stacking logic.

Handles extraction and grouping of Live Photos:
- Google Pixel Motion Photos (embedded MP4 after JPEG EOI)
- Samsung Motion Photos (MotionPhoto_Data marker)
- Apple Live Photos (paired .mov file)

This module moves embedded media extraction from directory_watcher to 
a dedicated stacks-aware component for better organization.
"""

from mmap import ACCESS_READ, mmap
from pathlib import Path
from typing import TYPE_CHECKING

import magic
from django.conf import settings

from api.models.file import File
from api.models.photo_stack import PhotoStack
from api.util import logger

if TYPE_CHECKING:
    from api.models.photo import Photo
    from api.models.user import User


# Markers for embedded motion video detection
JPEG_EOI_MARKER = b"\xff\xd9"
GOOGLE_PIXEL_MP4_SIGNATURES = [b"ftypmp42", b"ftypisom", b"ftypiso2"]
SAMSUNG_MOTION_MARKER = b"MotionPhoto_Data"

# Apple Live Photo video extensions
APPLE_LIVE_PHOTO_EXTENSIONS = [".mov", ".MOV"]


def _locate_google_embedded_video(data: bytes) -> int:
    """Find position of embedded MP4 in Google Motion Photo."""
    for signature in GOOGLE_PIXEL_MP4_SIGNATURES:
        position = data.find(signature)
        if position != -1:
            # MP4 header starts 4 bytes before ftyp
            return position - 4
    return -1


def _locate_samsung_embedded_video(data: bytes) -> int:
    """Find position of embedded video in Samsung Motion Photo."""
    position = data.find(SAMSUNG_MOTION_MARKER)
    if position != -1:
        # Video starts immediately after the marker
        return position + len(SAMSUNG_MOTION_MARKER)
    return -1


def has_embedded_motion_video(path: str) -> bool:
    """
    Check if a JPEG file contains an embedded motion video.
    
    Supports:
    - Google Pixel Motion Photos
    - Samsung Motion Photos
    
    Args:
        path: Path to the image file
        
    Returns:
        True if embedded video detected, False otherwise
    """
    try:
        mime = magic.Magic(mime=True)
        mime_type = mime.from_file(path)
        if mime_type != "image/jpeg":
            return False
            
        with open(path, "rb") as image:
            with mmap(image.fileno(), 0, access=ACCESS_READ) as mm:
                return (
                    _locate_google_embedded_video(mm) != -1 or
                    _locate_samsung_embedded_video(mm) != -1
                )
    except Exception as e:
        logger.warning(f"Error checking for embedded video in {path}: {e}")
        return False


def extract_embedded_motion_video(path: str, output_hash: str) -> str | None:
    """
    Extract embedded motion video from a JPEG file.
    
    Args:
        path: Path to the source image file
        output_hash: Hash to use for output filename
        
    Returns:
        Path to extracted video file, or None if extraction failed
    """
    try:
        with open(str(path), "rb") as image:
            with mmap(image.fileno(), 0, access=ACCESS_READ) as mm:
                # Try Google format first, then Samsung
                position = _locate_google_embedded_video(mm)
                if position == -1:
                    position = _locate_samsung_embedded_video(mm)
                    
                if position == -1:
                    return None
                    
                # Create output directory
                output_dir = Path(settings.MEDIA_ROOT) / "embedded_media"
                output_dir.mkdir(parents=True, exist_ok=True)
                
                output_path = output_dir / f"{output_hash}_motion.mp4"
                
                with open(output_path, "wb") as video:
                    mm.seek(position)
                    data = mm.read(mm.size() - position)
                    video.write(data)
                    
                logger.info(f"Extracted motion video to {output_path}")
                return str(output_path)
                
    except Exception as e:
        logger.error(f"Error extracting embedded video from {path}: {e}")
        return None


def find_apple_live_photo_video(image_path: str) -> str | None:
    """
    Find the companion .mov file for an Apple Live Photo.
    
    Apple Live Photos are stored as separate .HEIC/.JPG and .MOV files
    with the same base name (from ContentIdentifier).
    
    Args:
        image_path: Path to the image file
        
    Returns:
        Path to companion video file, or None if not found
    """
    base_path = Path(image_path)
    stem = base_path.stem
    parent = base_path.parent
    
    for ext in APPLE_LIVE_PHOTO_EXTENSIONS:
        video_path = parent / f"{stem}{ext}"
        if video_path.exists():
            return str(video_path)
            
    return None


def detect_live_photo(photo: "Photo", user: "User") -> PhotoStack | None:
    """
    Detect if a photo is part of a Live Photo and create a stack.
    
    This handles:
    1. Embedded motion videos (Google/Samsung) - extracts and links
    2. Apple Live Photos - finds and links companion video
    
    Args:
        photo: The Photo instance to check
        user: Owner of the photo
        
    Returns:
        PhotoStack instance if Live Photo detected, None otherwise
    """
    if not photo.main_file:
        return None
        
    image_path = photo.main_file.path
    
    # Check for embedded motion video (Google/Samsung)
    if has_embedded_motion_video(image_path):
        return _create_embedded_live_photo_stack(photo, user)
        
    # Check for Apple Live Photo companion video
    video_path = find_apple_live_photo_video(image_path)
    if video_path:
        return _create_apple_live_photo_stack(photo, video_path, user)
        
    return None


def _create_embedded_live_photo_stack(photo: "Photo", user: "User") -> PhotoStack | None:
    """Create stack for photo with embedded motion video."""
    if not settings.FEATURE_PROCESS_EMBEDDED_MEDIA:
        logger.debug("Embedded media processing disabled")
        return None
        
    image_path = photo.main_file.path
    video_path = extract_embedded_motion_video(image_path, photo.main_file.hash)
    
    if not video_path:
        return None
        
    # Create File record for the extracted video
    video_file = File.create(video_path, user)
    
    # Link as embedded media on the original file
    photo.main_file.embedded_media.add(video_file)
    
    # Create or update stack
    existing_stack = photo.stacks.filter(stack_type=PhotoStack.StackType.LIVE_PHOTO).first()
    if existing_stack:
        return existing_stack
        
    # Create new Live Photo stack
    stack = PhotoStack.objects.create(
        owner=user,
        stack_type=PhotoStack.StackType.LIVE_PHOTO,
        primary_photo=photo,
    )
    
    # Link photo to stack (ManyToMany)
    photo.stacks.add(stack)
    
    logger.info(f"Created Live Photo stack {stack.id} for embedded motion in {image_path}")
    return stack


def _create_apple_live_photo_stack(
    photo: "Photo", 
    video_path: str, 
    user: "User"
) -> PhotoStack | None:
    """Create stack for Apple Live Photo with companion video."""
    from api.models.photo import Photo
    
    # Check if video is already a known photo/file
    video_file = File.objects.filter(path=video_path).first()
    
    if not video_file:
        # Create File record for the video
        video_file = File.create(video_path, user)
        
    # Find or create the video as a Photo
    video_photo = Photo.objects.filter(main_file=video_file).first()
    
    if not video_photo:
        # Video file exists but no Photo record - might be created by scan
        # Link as embedded media instead
        photo.main_file.embedded_media.add(video_file)
        
    # Create or find stack
    existing_stack = photo.stacks.filter(stack_type=PhotoStack.StackType.LIVE_PHOTO).first()
    if existing_stack:
        stack = existing_stack
    else:
        stack = PhotoStack.objects.create(
            owner=user,
            stack_type=PhotoStack.StackType.LIVE_PHOTO,
            primary_photo=photo,
        )
        photo.stacks.add(stack)
        
    # If video is a separate Photo, link it to the same stack
    if video_photo and not video_photo.stacks.filter(stack_type=PhotoStack.StackType.LIVE_PHOTO).exists():
        video_photo.stacks.add(stack)
        
    logger.info(f"Created Apple Live Photo stack {stack.id} for {photo.main_file.path}")
    return stack


def process_live_photos_batch(user: "User", photos: list["Photo"]) -> dict:
    """
    Process multiple photos for Live Photo detection.
    
    Args:
        user: User who owns the photos
        photos: List of Photo instances to check
        
    Returns:
        Dict with counts: {detected: int, stacks_created: int}
    """
    detected = 0
    stacks_created = 0
    
    for photo in photos:
        try:
            stack = detect_live_photo(photo, user)
            if stack:
                detected += 1
                if stack.photo_count <= 1:
                    # New stack (might just have the photo, video linked separately)
                    stacks_created += 1
        except Exception as e:
            logger.error(f"Error processing Live Photo detection for {photo.id}: {e}")
            
    return {
        "detected": detected,
        "stacks_created": stacks_created,
    }
