"""
Perceptual hashing module for duplicate image detection.

Uses pHash (perceptual hash) algorithm which is robust to:
- Image resizing/scaling
- Compression artifacts (JPEG quality differences)
- Minor color adjustments
- Small crops (up to ~15% border removal)
"""

import functools
import logging
import math
import re
from collections.abc import Sequence
from typing import TYPE_CHECKING

from PIL import Image

from api.lazy_import import LazyModule

# Only the scan and duplicate detection hash, not the API server that imports
# this module.
if TYPE_CHECKING:
    import numpy as np
    import numpy.typing as npt
else:
    np = LazyModule("numpy")

logger = logging.getLogger(__name__)


# Threshold for considering two images as duplicates
# pHash produces 64-bit hashes, Hamming distance <= 10 indicates high similarity
DEFAULT_HAMMING_THRESHOLD = 10

HEX64_HASH = re.compile(r"[0-9a-fA-F]{16}")

# The image is shrunk to (hash_size * 4) pixels a side before the DCT.
_HIGHFREQ_FACTOR = 4

# Smaller coefficients are rounding noise of the matrix product where the
# FFT-based DCT of scipy, which computed every stored hash, returns an exact
# zero (rows or columns of one grey level). Real coefficients of an 8-bit
# image are many orders of magnitude larger.
_ZERO_SNAP = 1e-9


@functools.cache
def _dct_matrix(size: int) -> npt.NDArray[np.float64]:
    """The unnormalised type-II DCT as a matrix.

    ``_dct_matrix(n) @ x`` is ``scipy.fftpack.dct(x, axis=0)`` for an ``n``-row
    ``x``: ``y[k] = 2 * sum(x[i] * cos(pi * k * (2i + 1) / 2n))``.
    """
    k = np.arange(size, dtype=np.float64)[:, None]
    i = np.arange(size, dtype=np.float64)[None, :]
    matrix = 2.0 * np.cos(np.pi * k * (2 * i + 1) / (2 * size))
    matrix.setflags(write=False)
    return matrix


def phash(image: Image.Image, hash_size: int = 8) -> str:
    """The perceptual hash of *image* as hex, the value ``imagehash.phash`` gave.

    Every stored ``Photo.perceptual_hash`` came from ImageHash 4.3, and the scan
    compares new hashes with them, so this repeats its steps: grey levels, a
    Lanczos resize to ``4 * hash_size`` pixels a side, a 2-D DCT-II (columns,
    then rows), the top-left ``hash_size`` x ``hash_size`` coefficients
    compared with their median, and the bits row by row, most significant
    first. ``hash_size=8`` gives 16 hex digits.
    """
    if hash_size < 2:
        raise ValueError("Hash size must be greater than or equal to 2")
    size = hash_size * _HIGHFREQ_FACTOR
    grey = image.convert("L").resize((size, size), Image.Resampling.LANCZOS)
    pixels = np.asarray(grey, dtype=np.float64)
    dct = _dct_matrix(size)
    coefficients = dct @ pixels @ dct.T
    coefficients[np.abs(coefficients) < _ZERO_SNAP] = 0.0
    low = coefficients[:hash_size, :hash_size]
    bits = (low > np.median(low)).flatten()
    value = int("".join("1" if bit else "0" for bit in bits), 2)
    return f"{value:0{-(-bits.size // 4)}x}"


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
            source: Image.Image = img
            if img.mode not in ("RGB", "L"):
                source = img.convert("RGB")

            # Calculate pHash - uses DCT (Discrete Cosine Transform)
            # More robust than average hash or difference hash
            return phash(source, hash_size=hash_size)
    # OSError covers a missing, unreadable or unidentified file; ValueError a
    # mode or size the conversion or the DCT cannot take.
    except (OSError, ValueError, Image.DecompressionBombError) as e:
        logger.error("Failed to calculate perceptual hash for %s: %s", image_path, e)
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


def _square_hash(hex_hash: str) -> tuple[int, int]:
    """Value and bit count of a hash that is not 16 hex digits.

    Reads it the way ``imagehash.hex_to_hash`` did, so such a hash keeps its
    distances: a square of ``isqrt(4 * len)`` bits a side, zero-padded on the
    left. A value that does not fill whole rows is not a hash.
    """
    side = math.isqrt(len(hex_hash) * 4)
    value = int(hex_hash, 16)
    bit_count = max(side * side, value.bit_length())
    if value < 0 or side == 0 or bit_count % side:
        raise ValueError(f"not a square hash: {hex_hash!r}")
    return value, bit_count


def hamming_distance(hash1: str | None, hash2: str | None) -> int:
    """
    Calculate the Hamming distance between two perceptual hashes.

    Args:
        hash1: First hash as hex string
        hash2: Second hash as hex string

    Returns:
        Number of differing bits (0 = identical, higher = more different)
    """
    if (
        isinstance(hash1, str)
        and isinstance(hash2, str)
        and HEX64_HASH.fullmatch(hash1)
        and HEX64_HASH.fullmatch(hash2)
    ):
        # The usual 64-bit hash: XOR and count.
        return (int(hash1, 16) ^ int(hash2, 16)).bit_count()
    try:
        if hash1 is None or hash2 is None:
            raise ValueError("a hash is missing")
        value1, bits1 = _square_hash(hash1)
        value2, bits2 = _square_hash(hash2)
        if bits1 != bits2:
            raise ValueError(f"hashes of {bits1} and {bits2} bits")
        return (value1 ^ value2).bit_count()
    # ValueError: not a hex string, not a square hash, or two hashes of
    # different sizes.
    except ValueError as e:
        logger.error("Failed to calculate Hamming distance: %s", e)
        return 64  # Maximum distance (completely different)


def are_duplicates(
    hash1: str | None, hash2: str | None, threshold: int = DEFAULT_HAMMING_THRESHOLD
) -> bool:
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
    target_hash: str | None,
    hash_list: Sequence[tuple[str, str | None]],
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
