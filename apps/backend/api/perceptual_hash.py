"""
Perceptual hashing module for duplicate image detection.

Uses pHash (perceptual hash) algorithm which is robust to:
- Image resizing/scaling
- Compression artifacts (JPEG quality differences)
- Minor color adjustments
- Small crops (up to ~15% border removal)
"""

import imagehash
from PIL import Image

from api.util import logger

# Threshold for considering two images as duplicates
# pHash produces 64-bit hashes, Hamming distance <= 10 indicates high similarity
DEFAULT_HAMMING_THRESHOLD = 10


def calculate_perceptual_hash(image_path: str, hash_size: int = 8) -> str | None:
    """
    Calculate the perceptual hash (pHash) of an image.

    Args:
        image_path: Path to the image file
        hash_size: Size of the hash (default 8 produces 64-bit hash)

    Returns:
        Hex string representation of the perceptual hash, or None if failed
    """
    try:
        with Image.open(image_path) as img:
            # Convert to RGB if necessary (handles RGBA, palette images, etc.)
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")

            # Calculate pHash - uses DCT (Discrete Cosine Transform)
            # More robust than average hash or difference hash
            phash = imagehash.phash(img, hash_size=hash_size)
            return str(phash)
    except Exception as e:
        logger.error(f"Failed to calculate perceptual hash for {image_path}: {e}")
        return None


def calculate_hash_from_thumbnail(thumbnail_path: str) -> str | None:
    """
    Calculate perceptual hash from a thumbnail image.
    Using thumbnails is faster and still produces reliable hashes.

    Args:
        thumbnail_path: Path to the thumbnail file

    Returns:
        Hex string representation of the perceptual hash, or None if failed
    """
    return calculate_perceptual_hash(thumbnail_path)


def hamming_distance(hash1: str, hash2: str) -> int:
    """
    Calculate the Hamming distance between two perceptual hashes.

    Args:
        hash1: First hash as hex string
        hash2: Second hash as hex string

    Returns:
        Number of differing bits (0 = identical, higher = more different)
    """
    try:
        h1 = imagehash.hex_to_hash(hash1)
        h2 = imagehash.hex_to_hash(hash2)
        return h1 - h2  # imagehash overloads subtraction to return Hamming distance
    except Exception as e:
        logger.error(f"Failed to calculate Hamming distance: {e}")
        return 64  # Maximum distance (completely different)


def are_duplicates(hash1: str, hash2: str, threshold: int = DEFAULT_HAMMING_THRESHOLD) -> bool:
    """
    Determine if two images are duplicates based on their perceptual hashes.

    Args:
        hash1: First perceptual hash
        hash2: Second perceptual hash
        threshold: Maximum Hamming distance to consider as duplicates (default 10)

    Returns:
        True if images are likely duplicates, False otherwise
    """
    if not hash1 or not hash2:
        return False
    return hamming_distance(hash1, hash2) <= threshold


def find_similar_hashes(
    target_hash: str,
    hash_list: list[tuple[str, str]],
    threshold: int = DEFAULT_HAMMING_THRESHOLD,
) -> list[tuple[str, int]]:
    """
    Find all hashes similar to the target hash.

    Args:
        target_hash: The hash to compare against
        hash_list: List of (image_id, hash) tuples to search
        threshold: Maximum Hamming distance for similarity

    Returns:
        List of (image_id, distance) tuples for similar images, sorted by distance
    """
    if not target_hash:
        return []

    similar = []
    for image_id, hash_value in hash_list:
        if hash_value and hash_value != target_hash:
            distance = hamming_distance(target_hash, hash_value)
            if distance <= threshold:
                similar.append((image_id, distance))

    return sorted(similar, key=lambda x: x[1])
