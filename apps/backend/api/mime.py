"""What kind of file is this: the media extension sets and the content sniff.

Every question "is this extension a photo / video / RAW / sidecar?" is
answered from the sets below, in lower case: compare ``ext.lower()``. The
named subsets narrow a full set for one consumer and say why;
``api.tests.infra.test_single_definitions`` keeps them inside the full sets
and keeps extension literals out of the rest of the backend, so a format added
here reaches every consumer that should know about it.
"""

import mimetypes
import os

import filetype

# Image formats the scanner indexes: what image_decoding's libvips and Pillow
# plugins load.
IMAGE_EXTENSIONS = frozenset(
    {
        ".avif",
        ".bmp",
        ".gif",
        ".heic",
        ".heif",
        ".hif",
        ".j2k",
        ".jfif",
        ".jp2",
        ".jpe",
        ".jpeg",
        ".jpg",
        ".jxl",
        ".png",
        ".tif",
        ".tiff",
        ".webp",
    }
)
VIDEO_EXTENSIONS = frozenset(
    {
        ".3g2",
        ".3gp",
        ".asf",
        ".avi",
        ".flv",
        ".m2ts",
        ".m4v",
        ".mkv",
        ".mov",
        ".mp4",
        ".mpeg",
        ".mpg",
        ".mts",
        ".ogv",
        ".vob",
        ".webm",
        ".wmv",
    }
)
# Camera RAW formats: a File of type RAW_FILE, decoded by LibRaw.
RAW_EXTENSIONS = frozenset(
    {
        ".3fr",
        ".ari",
        ".arw",
        ".bay",
        ".cr2",
        ".cr3",
        ".crw",
        ".cs1",
        ".cxi",
        ".dcr",
        ".dng",
        ".eip",
        ".erf",
        ".fff",
        ".iiq",
        ".j6i",
        ".k25",
        ".kc2",
        ".kdc",
        ".mdc",
        ".mef",
        ".mfw",
        ".mos",
        ".mrw",
        ".nef",
        ".nrw",
        ".orf",
        ".pef",
        ".raf",
        ".raw",
        ".rw2",
        ".rwl",
        ".rwz",
        ".sr2",
        ".srf",
        ".srw",
        ".x3f",
    }
)
# Sidecars that describe a media file instead of being one.
XMP_EXTENSION = ".xmp"
METADATA_EXTENSIONS = frozenset({XMP_EXTENSION})
# A Google Takeout export's sidecar (``IMG_1.jpg.json``, api.metadata.takeout).
# Not a METADATA_EXTENSIONS member: the JSON is read during the scan of the
# media file it describes and never becomes a File of its own.
TAKEOUT_JSON_EXTENSION = ".json"

# Subset of IMAGE_EXTENSIONS: the processed images a RAW file or an Apple Live
# Photo video attaches to as a variant (file_grouping). Every everyday camera
# or phone output; not the archival/legacy ones (.bmp, .gif, .jp2, ...).
RAW_PAIR_EXTENSIONS = frozenset(
    {
        ".avif",
        ".heic",
        ".heif",
        ".hif",
        ".jpeg",
        ".jpg",
        ".jxl",
        ".png",
        ".tif",
        ".tiff",
        ".webp",
    }
)
# Subset of IMAGE_EXTENSIONS: what the OCR sidecar's cv2.imread decodes from
# the original. The opencv wheels have no HEIF, AVIF or JPEG XL decoder, so
# those (and RAW) are read from the big thumbnail instead.
CV2_DECODABLE_EXTENSIONS = frozenset(
    {".bmp", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"}
)
# Subset of IMAGE_EXTENSIONS: formats whose thumbnail follows an EXIF
# Orientation that exiftool writes into the file afterwards, measured through
# api.thumbnails.decoding.thumbnail (#2068). HEIC and AVIF keep the picture
# unrotated (libheif applies its own irot/imir and ignores the EXIF tag),
# exiftool cannot write EXIF into a bare JPEG XL codestream, BMP or GIF, and RAW
# files go through LibRaw in the thumbnail service, which is unverified.
EXIF_ORIENTED_EXTENSIONS = frozenset(
    {".jfif", ".jpe", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"}
)
# Subset of IMAGE_EXTENSIONS: HEIF containers (HEVC or AV1). libheif shows
# them under their irot/imir properties and ignores the EXIF Orientation,
# which a tool may have rewritten to disagree (#2615).
HEIF_EXTENSIONS = frozenset({".avif", ".heic", ".heif", ".hif"})
# Subset of VIDEO_EXTENSIONS: the motion half of an Apple Live Photo.
LIVE_PHOTO_VIDEO_EXTENSIONS = frozenset({".mov"})


def extension(path: str) -> str:
    """The extension of ``path`` in lower case, with its dot (``".jpg"``)."""
    return os.path.splitext(path)[1].lower()


def _is_mpeg_ts(path: str) -> bool:
    """filetype has no MPEG transport stream matcher; AVCHD camcorders (.MTS) need one.

    Plain TS packets are 188 bytes with the 0x47 sync byte first; AVCHD/Blu-ray
    M2TS prefix each packet with a 4-byte timestamp, so the sync sits at offset 4.
    """
    try:
        with open(path, "rb") as handle:
            head = handle.read(192 * 3)
    except OSError:
        return False
    return len(head) == 192 * 3 and (
        all(head[i] == 0x47 for i in (0, 188, 376))
        or all(head[i] == 0x47 for i in (4, 196, 388))
    )


_3GPP_BRANDS = ((b"3gp", "video/3gpp"), (b"3g2", "video/3gpp2"))


def _3gpp_mime_type(path: str) -> str | None:
    """filetype 1.2.0's 3GP matcher never matches; old phones' 3GPs need one (#2418).

    It compares ``ftyp3gp`` with the first bytes, where an ISO-BMFF file keeps
    the box size, so a 3GP was only caught by the MP4 matcher through an
    ``isom``/``mp41``/``mp42`` brand. Old phones list 3GPP brands only. The
    ``ftyp`` box is size, ``ftyp``, the major brand, a minor version, then the
    compatible brands; the first 3GPP or 3GPP2 one names the type.
    """
    try:
        with open(path, "rb") as handle:
            head = handle.read(64)
    except OSError:
        return None
    if len(head) < 12 or head[4:8] != b"ftyp":
        return None
    end = min(int.from_bytes(head[:4], "big"), len(head))
    brands = [head[8:12]] + [head[i : i + 4] for i in range(16, end - 3, 4)]
    for brand in brands:
        for prefix, mime in _3GPP_BRANDS:
            if brand.startswith(prefix):
                return mime
    return None


def sniffed_mime_type(path: str) -> str | None:
    """MIME type from the file's magic bytes, or None when nothing recognises them."""
    try:
        sniffed = filetype.guess_mime(path)
    except OSError:
        return None
    if sniffed is None:
        if _is_mpeg_ts(path):
            return "video/mp2t"
        return _3gpp_mime_type(path)
    return sniffed


def mime_type(path: str) -> str:
    """MIME type from the file's magic bytes, else its extension, else octet-stream."""
    return (
        sniffed_mime_type(path)
        or mimetypes.guess_type(path)[0]
        or "application/octet-stream"
    )
