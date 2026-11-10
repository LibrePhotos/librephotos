"""What kind of file is this: the media extension sets and the content sniff.

The sniff (``sniffed_mime_type``) reads the first ``SNIFF_BYTES`` of a file and
compares them with the signatures in ``_SIGNATURES``, the ones filetype 1.2.0
knew for images, audio and video (in its order and with its answers), plus
MPEG transport streams, 3GPs with only 3GPP brands, Canon CR3, BigTIFF and
JPEG XL. Anything else (documents, archives) sniffs as None.

Every question "is this extension a photo / video / RAW / sidecar?" is
answered from the sets below, in lower case: compare ``ext.lower()``. The
named subsets narrow a full set for one consumer and say why;
``api.tests.infra.test_single_definitions`` keeps them inside the full sets
and keeps extension literals out of the rest of the backend, so a format added
here reaches every consumer that should know about it.
"""

import mimetypes
import os
from collections.abc import Callable

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
# What a copy without metadata is written as (api.sharing.copies, #2731): a
# still as a JPEG, a video in its own container, or MP4 when it has no
# extension to keep.
JPEG_EXTENSION = ".jpg"
MP4_EXTENSION = ".mp4"


def extension(path: str) -> str:
    """The extension of ``path`` in lower case, with its dot (``".jpg"``)."""
    return os.path.splitext(path)[1].lower()


# How much of a file the sniff reads: the most any signature below needs
# (a Matroska doctype or an APNG's chunks can sit a few KiB in).
SNIFF_BYTES = 8192


def _ftyp(head: bytes) -> tuple[str, list[str]] | None:
    """The major and compatible brands of an ISO-BMFF ``ftyp`` box that fits
    in ``head``, or None. Brands are ASCII, undecodable bytes dropped."""
    if len(head) < 16 or head[4:8] != b"ftyp":
        return None
    size = int.from_bytes(head[:4], "big")
    if len(head) < size:
        return None
    major = head[8:12].decode(errors="ignore")
    compatible = [head[i : i + 4].decode(errors="ignore") for i in range(16, size, 4)]
    return major, compatible


def _apng(head: bytes) -> bool:
    """A PNG whose acTL chunk comes before its image data."""
    if not head.startswith(b"\x89PNG\r\n\x1a\n"):
        return False
    i = 8
    while len(head) > i:
        length = int.from_bytes(head[i : i + 4], "big")
        kind = head[i + 4 : i + 8]
        if kind in (b"IDAT", b"IEND"):
            return False
        if kind == b"acTL":
            return True
        i += 8 + length + 4
    return False


def _tiff_header(head: bytes, magic: int) -> bool:
    return head[:4] in (
        b"II" + magic.to_bytes(2, "little"),
        b"MM" + magic.to_bytes(2, "big"),
    )


def _heif(brand: str) -> Callable[[bytes], bool]:
    def match(head: bytes) -> bool:
        ftyp = _ftyp(head)
        if ftyp is None:
            return False
        major, compatible = ftyp
        return major == brand or (major in ("mif1", "msf1") and brand in compatible)

    return match


def _mp4(head: bytes) -> bool:
    ftyp = _ftyp(head)
    if ftyp is None:
        return False
    major, compatible = ftyp
    return any(brand in ("mp41", "mp42", "isom") for brand in [*compatible, major])


def _major_brand(brand: str) -> Callable[[bytes], bool]:
    def match(head: bytes) -> bool:
        ftyp = _ftyp(head)
        return ftyp is not None and ftyp[0] == brand

    return match


def _ebml_doctype(doctype: bytes) -> Callable[[bytes], bool]:
    """Matroska and WebM: an EBML header naming the doctype (as its element)."""
    element = b"\x42\x82" + bytes([0x80 | len(doctype)]) + doctype
    return lambda head: head.startswith(b"\x1a\x45\xdf\xa3") and element in head


def _riff(form: bytes) -> Callable[[bytes], bool]:
    return lambda head: len(head) > 11 and head[:4] == b"RIFF" and head[8:12] == form


def _at(offset: int, signature: bytes, minimum: int = 0) -> Callable[[bytes], bool]:
    """``signature`` at ``offset``, in a head longer than ``minimum`` bytes."""
    end = offset + len(signature)
    return lambda head: len(head) > minimum and head[offset:end] == signature


# Every signature, in the order they are tried: the first match names the
# type. Images, audio and video, in the order filetype 1.2.0 tried them, which
# this replaces (#2418), so a file gets the answer it got from it, with Canon
# CR3 ahead of the videos; then BigTIFF and JPEG XL, which filetype lacked.
# Audio comes before video so an M4A is not a video.
_SIGNATURES: tuple[tuple[Callable[[bytes], bool], str], ...] = (
    (_at(0, b"AC10"), "image/vnd.dwg"),
    (_at(0, b"gimp xcf v"), "image/x-xcf"),
    (_at(0, b"\xff\xd8\xff", 2), "image/jpeg"),
    (
        lambda head: (
            len(head) > 50
            and head[:4] == b"\x00\x00\x00\x0c"
            and head[16:24] == b"ftypjp2 "
        ),
        "image/jpx",
    ),
    (_apng, "image/apng"),
    (_at(0, b"\x89PNG", 3), "image/png"),
    (_at(0, b"GIF", 2), "image/gif"),
    (
        lambda head: len(head) > 13 and head[:4] == b"RIFF" and head[8:14] == b"WEBPVP",
        "image/webp",
    ),
    (
        lambda head: len(head) > 9 and _tiff_header(head, 42) and head[8:10] != b"CR",
        "image/tiff",
    ),
    (
        lambda head: len(head) > 9 and _tiff_header(head, 42) and head[8:10] == b"CR",
        "image/x-canon-cr2",
    ),
    (_at(0, b"BM", 1), "image/bmp"),
    (_at(0, b"II\xbc", 2), "image/vnd.ms-photo"),
    (_at(0, b"8BPS", 3), "image/vnd.adobe.photoshop"),
    (_at(0, b"\x00\x00\x01\x00", 3), "image/x-icon"),
    (_heif("heic"), "image/heic"),
    (_at(128, b"DICM", 132), "application/dicom"),
    (_heif("avif"), "image/avif"),
    (lambda head: head[:2] in (b"\xff\xf1", b"\xff\xf9"), "audio/aac"),
    (_at(0, b"MThd", 3), "audio/midi"),
    (
        lambda head: (
            len(head) > 2
            and (
                head[:3] == b"ID3"
                or head[:2] in (b"\xff\xf2", b"\xff\xf3", b"\xff\xfb")
            )
        ),
        "audio/mpeg",
    ),
    (
        lambda head: (
            len(head) > 10 and (head[4:11] == b"ftypM4A" or head[:4] == b"M4A ")
        ),
        "audio/mp4",
    ),
    (_at(0, b"OggS", 3), "audio/ogg"),
    (_at(0, b"fLaC", 3), "audio/x-flac"),
    (_riff(b"WAVE"), "audio/x-wav"),
    (_at(0, b"#!AMR\n", 11), "audio/amr"),
    (
        lambda head: len(head) > 11 and head[:4] == b"FORM" and head[8:12] == b"AIFF",
        "audio/x-aiff",
    ),
    # Canon CR3 is ISO-BMFF with an isom brand: a RAW, not an MP4 video.
    (_major_brand("crx "), "image/x-canon-cr3"),
    (_at(0, b"ftyp3gp"), "video/3gpp"),
    (_mp4, "video/mp4"),
    (_at(0, b"\x00\x00\x00\x1cftypM4V", 10), "video/x-m4v"),
    (_ebml_doctype(b"matroska"), "video/x-matroska"),
    (_major_brand("qt  "), "video/quicktime"),
    (_riff(b"AVI "), "video/x-msvideo"),
    (_at(0, b"\x30\x26\xb2\x75\x8e\x66\xcf\x11\xa6\xd9", 9), "video/x-ms-wmv"),
    (
        lambda head: (
            len(head) > 3 and head[:3] == b"\x00\x00\x01" and 0xB0 <= head[3] <= 0xBF
        ),
        "video/mpeg",
    ),
    (_ebml_doctype(b"webm"), "video/webm"),
    (_at(0, b"FLV\x01", 3), "video/x-flv"),
    (lambda head: _tiff_header(head, 43), "image/tiff"),
    (
        lambda head: (
            head[:2] == b"\xff\x0a" or head[:12] == b"\x00\x00\x00\x0cJXL \r\n\x87\n"
        ),
        "image/jxl",
    ),
)


def _is_mpeg_ts(head: bytes) -> bool:
    """An MPEG transport stream: AVCHD camcorders' .MTS (#2149).

    Plain TS packets are 188 bytes with the 0x47 sync byte first; AVCHD/Blu-ray
    M2TS prefix each packet with a 4-byte timestamp, so the sync sits at offset 4.
    """
    return len(head) >= 192 * 3 and (
        all(head[i] == 0x47 for i in (0, 188, 376))
        or all(head[i] == 0x47 for i in (4, 196, 388))
    )


_3GPP_BRANDS = (("3gp", "video/3gpp"), ("3g2", "video/3gpp2"))


def _3gpp_mime_type(head: bytes) -> str | None:
    """A 3GP whose brands are 3GPP ones only, as old phones write (#2418).

    The ``ftyp`` box is size, ``ftyp``, the major brand, a minor version, then
    the compatible brands; the first 3GPP or 3GPP2 one names the type. Only the
    first 64 bytes are looked at, as before.
    """
    head = head[:64]
    if len(head) < 12 or head[4:8] != b"ftyp":
        return None
    end = min(int.from_bytes(head[:4], "big"), len(head))
    brands = [head[8:12]] + [head[i : i + 4] for i in range(16, end - 3, 4)]
    for brand in brands:
        for prefix, mime in _3GPP_BRANDS:
            if brand.startswith(prefix.encode()):
                return mime
    return None


def sniff(head: bytes) -> str | None:
    """The MIME type ``head`` (a file's first SNIFF_BYTES) starts like, or None."""
    for matches, mime in _SIGNATURES:
        if matches(head):
            return mime
    if _is_mpeg_ts(head):
        return "video/mp2t"
    return _3gpp_mime_type(head)


def sniffed_mime_type(path: str) -> str | None:
    """MIME type from the file's magic bytes, or None when nothing recognises
    them or the file cannot be read."""
    try:
        with open(path, "rb") as handle:
            head = handle.read(SNIFF_BYTES)
    except OSError:
        return None
    return sniff(head)


def mime_type(path: str) -> str:
    """MIME type from the file's magic bytes, else its extension, else octet-stream."""
    return (
        sniffed_mime_type(path)
        or mimetypes.guess_type(path)[0]
        or "application/octet-stream"
    )


# Camera RAW has no registered MIME type, and a content sniff misnames it: most
# RAW formats are TIFF containers (image/tiff) and CR3 is ISO BMFF. Every RAW
# original is reported as shared-mime-info's parent type for camera RAW.
RAW_MIME_TYPE = "image/x-dcraw"
# Formats that neither the sniff nor every platform's mimetypes table knows.
_MIME_TYPE_FALLBACKS = {".jxl": "image/jxl"}


def original_mime_type(path: str) -> str:
    """What a photo's original is, in lower case, for clients to decide whether they can draw it.

    A RAW file by its extension (``RAW_MIME_TYPE``), anything else by its magic
    bytes, then its extension, else ``application/octet-stream``.
    """
    ext = extension(path)
    if ext in RAW_EXTENSIONS:
        return RAW_MIME_TYPE
    found = (
        sniffed_mime_type(path)
        or _MIME_TYPE_FALLBACKS.get(ext)
        or mimetypes.guess_type(path)[0]
        or "application/octet-stream"
    )
    return found.lower()


def still_content_type(path: str) -> str:
    """The ``Content-Type`` a still photo's original is served with.

    Its real type when that is an image, else ``application/octet-stream``:
    an original is served inline on the app's own origin, so a type a browser
    runs (SVG, HTML) must never reach it.
    """
    found = original_mime_type(path)
    if found.startswith("image/") and "svg" not in found:
        return found
    return "application/octet-stream"
